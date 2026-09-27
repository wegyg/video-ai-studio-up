/**
 * Audio assembly: build a single narration track from per-scene TTS clips
 * placed at each scene's start time, and mux (narration + optional music) onto
 * the final video. Pure FFmpeg — works everywhere FFmpeg runs.
 */
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EditPlan } from "./schema";
import type { TTSProvider } from "./providers/types";

const pexec = promisify(execFile);

async function ffprobeDuration(file: string): Promise<number> {
  try {
    const { stdout } = await pexec("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", file,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Synthesize narration for each scene and lay it out on a single track of
 * length `totalSec`, each clip starting at its scene's start time (adelay).
 * Returns the track path, or null if there is no narration at all.
 */
export async function buildNarrationTrack(
  plan: EditPlan,
  tts: TTSProvider,
  workDir: string,
  totalSec: number,
): Promise<string | null> {
  fs.mkdirSync(workDir, { recursive: true });
  const parts: { file: string; startMs: number }[] = [];

  for (let i = 0; i < plan.timeline.length; i++) {
    const scene = plan.timeline[i];
    const text = (scene.narration || "").trim();
    if (!text) continue;
    const out = path.join(workDir, `nar_${i}.mp3`);
    const made = await tts.synthesize(text, out, plan.voice);
    if (made && fs.existsSync(made)) {
      parts.push({ file: made, startMs: Math.round(scene.start * 1000) });
    }
  }

  if (parts.length === 0) return null;

  // Build a filter graph: each input delayed to its scene start, then amix.
  const inputs: string[] = [];
  const filters: string[] = [];
  parts.forEach((p, idx) => {
    inputs.push("-i", p.file);
    // adelay needs per-channel values; use stereo
    filters.push(`[${idx}:a]adelay=${p.startMs}|${p.startMs},apad[a${idx}]`);
  });
  const mixLabels = parts.map((_, idx) => `[a${idx}]`).join("");
  const track = path.join(workDir, "narration.m4a");
  const filterComplex =
    filters.join(";") +
    `;${mixLabels}amix=inputs=${parts.length}:normalize=0:duration=longest[mix];` +
    `[mix]atrim=0:${totalSec},asetpts=N/SR/TB[out]`;

  await pexec("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-c:a", "aac", "-b:a", "160k",
    track,
  ]);
  return track;
}

/**
 * Mux narration and/or music under a (silent) video.
 * - narration plays at full volume
 * - music is ducked (music_duck_db) and looped/trimmed to the video length
 * Returns the muxed output path (writes to `outPath`).
 */
export async function muxAudio(
  videoPath: string,
  outPath: string,
  opts: { narrationPath?: string | null; musicPath?: string | null; duckDb?: number; totalSec: number },
): Promise<string> {
  const { narrationPath, musicPath, duckDb = -18, totalSec } = opts;

  if (!narrationPath && !musicPath) {
    // nothing to add; just copy the video through
    if (videoPath !== outPath) fs.copyFileSync(videoPath, outPath);
    return outPath;
  }

  const inputs: string[] = ["-i", videoPath];
  let narIdx = -1;
  let musIdx = -1;
  let idx = 1;
  if (narrationPath) {
    inputs.push("-i", narrationPath);
    narIdx = idx++;
  }
  if (musicPath) {
    inputs.push("-stream_loop", "-1", "-i", musicPath);
    musIdx = idx++;
  }

  let filterComplex: string;
  if (narIdx >= 0 && musIdx >= 0) {
    // Sidechain-duck the music by the narration: music dips ONLY while the
    // narration actually has signal. With silent narration, music stays full.
    const threshold = Math.pow(10, duckDb / 20); // duck target as ratio hint
    filterComplex =
      `[${narIdx}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,apad,asplit=2[narmix][narsc];` +
      `[${musIdx}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[mus];` +
      `[mus][narsc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400:makeup=1[musd];` +
      `[narmix][musd]amix=inputs=2:normalize=0:duration=first,volume=3.0[aout]`;
    void threshold;
  } else if (narIdx >= 0) {
    filterComplex = `[${narIdx}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1.6[aout]`;
  } else {
    // music only -> play at full level
    filterComplex = `[${musIdx}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=2.2[aout]`;
  }

  await pexec("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k",
    "-t", String(totalSec),
    "-shortest",
    outPath,
  ]);
  return outPath;
}
