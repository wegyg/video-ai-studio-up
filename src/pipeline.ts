/**
 * ShortsDirector pipeline: input (video + one-line brief) -> plan -> validate
 * -> render. Runs fully API-free by default (free providers). Paid providers
 * (STT/LLM/TTS) can be injected without changing this orchestrator.
 */
import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import type { AspectRatio, EditPlan } from "./schema";
import { validatePlan, formatIssues, type ValidationResult } from "./validate";
import { probeClip } from "./probe";
import type { PlanProvider, STTProvider, TTSProvider, SourceClipInfo, Transcript } from "./providers/types";
import { freeSTT } from "./providers/free";
import { selectPlanProvider } from "./providers/llm";
import { selectTTSProvider } from "./providers/tts";
import { buildNarrationTrack, muxAudio } from "./audio";

export interface PipelineInput {
  brief: string;
  clipPaths: string[]; // uploaded footage (may be empty -> placeholders)
  ratio?: AspectRatio;
  durationSec?: number;
  fps?: number;
  outPath?: string;
}

export interface PipelineDeps {
  stt?: STTProvider;
  planner?: PlanProvider;
  tts?: TTSProvider;
  onProgress?: (stage: string, detail?: string) => void;
}

export interface PipelineResult {
  outPath: string;
  plan: EditPlan;
  validation: ValidationResult;
}

export async function runPipeline(input: PipelineInput, deps: PipelineDeps = {}): Promise<PipelineResult> {
  const stt = deps.stt ?? freeSTT;
  const planner = deps.planner ?? selectPlanProvider(); // LLM if key set, else template
  const tts = deps.tts ?? selectTTSProvider(); // spoken if TTS key set, else silent
  const log = deps.onProgress ?? (() => {});
  const ratio: AspectRatio = input.ratio ?? "9:16";
  const fps = input.fps ?? 30;
  const durationSec = input.durationSec ?? 20;
  const outPath = input.outPath ?? path.resolve("out/output.mp4");

  // 1) Ingest: probe each uploaded clip. ------------------------------------
  log("ingest", `${input.clipPaths.length} clip(s)`);
  const clips: SourceClipInfo[] = [];
  for (let i = 0; i < input.clipPaths.length; i++) {
    const p = input.clipPaths[i];
    const meta = await probeClip(p);
    clips.push({ id: `clip_${i}`, path: p, ...meta });
  }

  // 2) Transcribe (free = no-op). -------------------------------------------
  log("transcribe", stt.name);
  const transcripts: Transcript[] = [];
  for (const c of clips) transcripts.push(await stt.transcribe(c));

  // 3) Generate the edit plan. ----------------------------------------------
  log("plan", planner.name);
  let plan = await planner.generate({ brief: input.brief, clips, transcripts, ratio, durationSec, fps });

  // 4) Validate + auto-fix. --------------------------------------------------
  log("validate");
  const validation = validatePlan(plan);
  plan = validation.plan; // apply auto-fixes
  if (!validation.ok) {
    // Errors remain (e.g. pace). Surface them; caller decides. We still render
    // so the user can see the result, but flag it.
    log("validate", "issues:\n" + formatIssues(validation.issues));
  }

  // 5) Narration synthesis (silent-timed fallback by default). --------------
  log("tts", tts.name);
  const totalSec = plan.format.duration_sec;
  const audioDir = path.join(path.dirname(outPath), "_audio");
  const narrationPath = await buildNarrationTrack(plan, tts, audioDir, totalSec);

  // 6) Music bed (procedural / optional local). -----------------------------
  const musicPath = await resolveMusic(plan, audioDir, totalSec, log);

  // 7) Render (video only -> silent temp), then mux audio. ------------------
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const serveUrl = await bundle({ entryPoint: path.resolve("remotion/index.ts") });
  const silentVideo = path.join(path.dirname(outPath), "_video_silent.mp4");

  if (clips.length === 0) {
    // No footage -> Remotion renders the full placeholder video directly.
    log("render", `placeholder backgrounds`);
    const composition = await selectComposition({
      serveUrl,
      id: "Plan",
      inputProps: { plan, clipSrcMap: {}, mode: "full" },
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: silentVideo,
      inputProps: { plan, clipSrcMap: {}, mode: "full" },
      concurrency: 2,
    });
  } else {
    // Footage present -> render TRANSPARENT overlay (captions + motion) with
    // Remotion, then composite over the user's clips with FFmpeg. This avoids
    // Remotion's video compositor (needs newer GLIBC than this env has).
    log("render", "overlay (transparent) via Remotion");
    const overlayPath = path.resolve(path.dirname(outPath), "_overlay.mov");
    const composition = await selectComposition({
      serveUrl,
      id: "Plan",
      inputProps: { plan, clipSrcMap: {}, mode: "overlay" },
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: "prores", // ProRes 4444 keeps the alpha channel
      proResProfile: "4444",
      pixelFormat: "yuva444p10le",
      imageFormat: "png", // required for transparent frames
      outputLocation: overlayPath,
      inputProps: { plan, clipSrcMap: {}, mode: "overlay" },
      concurrency: 2,
    });

    log("composite", "FFmpeg: user footage + overlay");
    await compositeWithFootage(plan, clips, overlayPath, silentVideo);
    try {
      fs.unlinkSync(overlayPath);
    } catch {
      /* ignore */
    }
  }

  // 8) Mux narration + music under the video. -------------------------------
  const hasAudio = Boolean(narrationPath || musicPath);
  if (hasAudio) {
    log("composite", "FFmpeg: mixing narration + music");
    await muxAudio(silentVideo, outPath, {
      narrationPath,
      musicPath,
      duckDb: plan.music.duck_db,
      totalSec,
    });
    try {
      fs.unlinkSync(silentVideo);
    } catch {
      /* ignore */
    }
  } else {
    // no audio -> the silent video IS the output
    fs.renameSync(silentVideo, outPath);
  }
  try {
    fs.rmSync(audioDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  log("done", outPath);
  return { outPath, plan, validation };
}

/**
 * Build the footage background track with FFmpeg (one segment per scene,
 * normalized to WxH and trimmed to scene length, distributed round-robin over
 * the uploaded clips), then overlay the transparent Remotion layer on top.
 */
async function compositeWithFootage(
  plan: EditPlan,
  clips: SourceClipInfo[],
  overlayPath: string,
  outPath: string,
): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const pexec = promisify(execFile);
  const { ratioToDimensions } = await import("../remotion/dimensions");
  const { width, height } = ratioToDimensions(plan.format.ratio);
  const fps = plan.format.fps;

  const tmpDir = path.resolve(path.dirname(outPath), "_segments");
  fs.mkdirSync(tmpDir, { recursive: true });

  // 1) one normalized background segment per scene
  const segPaths: string[] = [];
  for (let i = 0; i < plan.timeline.length; i++) {
    const scene = plan.timeline[i];
    const dur = Math.max(0.1, scene.end - scene.start);
    const clip = clips[i % clips.length];
    const seg = path.join(tmpDir, `seg_${i}.mp4`);
    // loop the source so short clips fill the scene; scale+crop to WxH; drop audio
    await pexec("ffmpeg", [
      "-y",
      "-stream_loop", "-1", "-i", clip.path,
      "-t", String(dur),
      "-an",
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      seg,
    ]);
    segPaths.push(seg);
  }

  // 2) concat the background segments
  const listFile = path.join(tmpDir, "list.txt");
  fs.writeFileSync(listFile, segPaths.map((p) => `file '${p}'`).join("\n"));
  const bgPath = path.join(tmpDir, "bg.mp4");
  await pexec("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", bgPath]);

  // 3) overlay the transparent Remotion layer on top of the footage bg
  await pexec("ffmpeg", [
    "-y",
    "-i", bgPath,
    "-i", overlayPath,
    "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]",
    "-map", "[v]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-shortest",
    outPath,
  ]);

  // cleanup segments
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}


/**
 * Resolve a background music track for the plan: a local royalty-free file if
 * present, else a procedurally-synthesized tone-aware bed (FFmpeg). Music is on
 * by default; set MUSIC_ENABLED=false to disable.
 */
async function resolveMusic(
  plan: EditPlan,
  workDir: string,
  totalSec: number,
  log: (stage: string, detail?: string) => void,
): Promise<string | null> {
  if (process.env.MUSIC_ENABLED === "false") return null;
  const { resolveMusicTrack } = await import("./music");
  const res = await resolveMusicTrack(plan, workDir, totalSec);
  if (res) log("music", `${res.source} (${plan.music.mood}, ${plan.music.bpm}bpm)`);
  return res?.path ?? null;
}
