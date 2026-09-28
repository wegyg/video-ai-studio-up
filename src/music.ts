/**
 * Background music.
 *
 * resolveMusicTrack() returns a ready-to-mix music file for a plan:
 *  1. A local royalty-free file from assets/music/ if present (your own loops).
 *  2. Otherwise a procedurally-synthesized ambient bed generated with FFmpeg —
 *     zero files, zero licensing concerns, always available.
 *
 * The bed's chord + tempo are derived from the plan's mood/bpm so it fits the
 * vibe. It sits UNDER the narration (ducking is applied later in muxAudio).
 */
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EditPlan } from "./schema";
import { ffmpegPath } from "./ffmpeg";

const pexec = promisify(execFile);

// Note frequencies (Hz).
const NOTE: Record<string, number> = {
  A2: 110.0, C3: 130.81, E3: 164.81, G3: 196.0, A3: 220.0,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0,
};

interface MoodProfile {
  chord: string[];
  gain: number; // pre-duck loudness of the bed
}

/** Map a free-text mood to a chord + loudness. Keyword-based, with a default. */
function profileForMood(mood: string): MoodProfile {
  const m = (mood || "").toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => mood.includes(k) || m.includes(k));

  if (has("luxury", "고급", "차분", "신뢰", "calm", "trust")) {
    return { chord: ["A3", "C4", "E4"], gain: 0.42 }; // smooth minor-ish
  }
  if (has("energetic", "경쾌", "밝", "activ", "upbeat", "pop")) {
    return { chord: ["C4", "E4", "G4"], gain: 0.5 }; // bright major
  }
  if (has("playful", "발랄", "fun", "bounce")) {
    return { chord: ["D4", "F4", "A4"], gain: 0.48 };
  }
  if (has("professional", "전문", "clean")) {
    return { chord: ["C3", "G3", "C4"], gain: 0.4 };
  }
  return { chord: ["C4", "E4", "A4"], gain: 0.44 }; // friendly default
}

function localMusicDir(): string {
  return path.resolve("assets", "music");
}

/** Find a user-provided royalty-free track, if any. */
export function findLocalTrack(): string | null {
  const dir = localMusicDir();
  if (!fs.existsSync(dir)) return null;
  const exts = new Set([".mp3", ".wav", ".m4a", ".ogg", ".aac"]);
  const hits = fs
    .readdirSync(dir)
    .filter((f) => exts.has(path.extname(f).toLowerCase()))
    .sort();
  return hits.length ? path.join(dir, hits[0]) : null;
}

/** Synthesize an ambient music bed with FFmpeg. Returns the output path. */
export async function synthesizeBed(
  music: EditPlan["music"],
  durationSec: number,
  outPath: string,
): Promise<string> {
  const { chord, gain } = profileForMood(music.mood);
  const bpm = Math.min(160, Math.max(60, music.bpm || 100));
  const dur = Math.max(durationSec + 0.5, 2);

  // Build sine oscillators for the chord + a low kick oscillator.
  const inputs: string[] = [];
  chord.forEach((n) => {
    const f = NOTE[n] ?? 261.63;
    inputs.push("-f", "lavfi", "-t", String(dur), "-i", `sine=frequency=${f}:sample_rate=44100`);
  });
  const kickIdx = chord.length;
  inputs.push("-f", "lavfi", "-t", String(dur), "-i", "sine=frequency=55:sample_rate=44100");

  const chordLabels = chord.map((_, i) => `[${i}:a]`).join("");
  const kickHz = (bpm / 60).toFixed(3); // beats per second
  const fadeOut = (dur - 0.8).toFixed(2);

  const filter =
    `${chordLabels}amix=inputs=${chord.length}:normalize=1[chord];` +
    `[chord]tremolo=f=5:d=0.22,lowpass=f=2600,aformat=channel_layouts=stereo[chordfx];` +
    `[${kickIdx}:a]tremolo=f=${kickHz}:d=0.9,lowpass=f=120,volume=0.45[kick];` +
    `[chordfx][kick]amix=inputs=2:normalize=0,volume=${gain.toFixed(3)},` +
    `afade=t=in:st=0:d=0.6,afade=t=out:st=${fadeOut}:d=0.8[out]`;

  await pexec(ffmpegPath(), [
    "-y",
    ...inputs,
    "-filter_complex", filter,
    "-map", "[out]",
    "-c:a", "aac", "-b:a", "160k",
    outPath,
  ]);
  return outPath;
}

/**
 * Resolve a music track for the plan: local file first, else a procedural bed.
 * Returns null only if synthesis fails (never lets music break the render).
 */
export async function resolveMusicTrack(
  plan: EditPlan,
  workDir: string,
  durationSec: number,
): Promise<{ path: string; source: "local" | "procedural" } | null> {
  const local = findLocalTrack();
  if (local) return { path: local, source: "local" };
  try {
    fs.mkdirSync(workDir, { recursive: true });
    const out = path.join(workDir, "music.m4a");
    await synthesizeBed(plan.music, durationSec, out);
    return { path: out, source: "procedural" };
  } catch (err) {
    console.warn(`[music] synthesis failed, no music: ${(err as Error).message}`);
    return null;
  }
}
