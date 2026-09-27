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
  const chains: string[] = [];
  const mixLabels: string[] = [];
  let idx = 1;

  if (narrationPath) {
    inputs.push("-i", narrationPath);
    chains.push(`[${idx}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[nar]`);
    mixLabels.push("[nar]");
    idx++;
  }
  if (musicPath) {
    inputs.push("-stream_loop", "-1", "-i", musicPath);
    const gain = Math.pow(10, duckDb / 20); // dB -> linear
    chains.push(
      `[${idx}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${gain.toFixed(3)}[mus]`,
    );
    mixLabels.push("[mus]");
    idx++;
  }

  const mix =
    mixLabels.length > 1
      ? `${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0:duration=first[aout]`
      : `${mixLabels[0]}anull[aout]`;

  const filterComplex = [...chains, mix].join(";");

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
