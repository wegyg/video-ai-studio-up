/**
 * ShortsDirector pipeline: input (video + one-line brief) -> plan -> validate
 * -> render. Runs fully API-free by default (free providers). Paid providers
 * (STT/LLM/TTS) can be injected without changing this orchestrator.
 */
import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

import type { AspectRatio, EditPlan } from "./schema";
import { validatePlan, formatIssues, type ValidationResult } from "./validate";
import { ffmpegPath } from "./ffmpeg";
import { probeClip } from "./probe";
import type { PlanProvider, STTProvider, TTSProvider, SourceClipInfo, Transcript } from "./providers/types";
import { freeSTT } from "./providers/free";
import { selectPlanProvider } from "./providers/llm";
import { selectTTSProvider } from "./providers/tts";
import { buildNarrationTrack, muxAudio } from "./audio";

export interface PipelineInput {
  brief: string;
  reference?: string; // homepage URL or reference notes
  clipPaths: string[]; // uploaded footage (may be empty -> placeholders)
  ratio?: AspectRatio;
  durationSec?: number;
  fps?: number;
  captionStyle?: import("./schema").CaptionStyle;
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
  thumbnailPath: string | null;
  plan: EditPlan;
  validation: ValidationResult;
}

/** Stage 1: ingest footage + generate + validate a plan (no rendering). */
export async function generatePlan(
  input: PipelineInput,
  deps: PipelineDeps = {},
): Promise<{ plan: EditPlan; clips: SourceClipInfo[]; validation: ValidationResult }> {
  const stt = deps.stt ?? freeSTT;
  const planner = deps.planner ?? selectPlanProvider();
  const log = deps.onProgress ?? (() => {});
  const ratio: AspectRatio = input.ratio ?? "9:16";
  const fps = input.fps ?? 30;
  const durationSec = input.durationSec ?? 20;

  log("ingest", `${input.clipPaths.length} clip(s)`);
  const clips: SourceClipInfo[] = [];
  for (let i = 0; i < input.clipPaths.length; i++) {
    const meta = await probeClip(input.clipPaths[i]);
    clips.push({ id: `clip_${i}`, path: input.clipPaths[i], ...meta });
  }

  log("transcribe", stt.name);
  const transcripts: Transcript[] = [];
  for (const c of clips) transcripts.push(await stt.transcribe(c));

  // Resolve reference material (homepage URL -> page text, or notes as-is).
  let referenceText = "";
  if (input.reference && input.reference.trim()) {
    log("plan", "참고 자료 분석 중");
    const { resolveReference } = await import("./reference");
    const ref = await resolveReference(input.reference);
    referenceText = ref.text;
  }

  log("plan", planner.name);
  let plan = await planner.generate({
    brief: input.brief,
    clips,
    transcripts,
    ratio,
    durationSec,
    fps,
    reference: referenceText,
  });
  if (input.captionStyle) plan.format.caption_style = input.captionStyle;

  log("validate");
  const validation = validatePlan(plan);
  plan = validation.plan;
  if (!validation.ok) log("validate", "issues:\n" + formatIssues(validation.issues));

  return { plan, clips, validation };
}

export async function runPipeline(input: PipelineInput, deps: PipelineDeps = {}): Promise<PipelineResult> {
  const tts = deps.tts ?? selectTTSProvider(); // spoken if TTS key set, else silent
  const log = deps.onProgress ?? (() => {});
  const outPath = input.outPath ?? path.resolve("out/output.mp4");

  const { plan, clips, validation } = await generatePlan(input, deps);

  return renderPlan(plan, clips, { tts, log, outPath, validation });
}

/** Stage 2: render a (possibly edited) plan + already-ingested clips to MP4. */
export async function renderPlan(
  plan: EditPlan,
  clips: SourceClipInfo[],
  opts: {
    tts?: import("./providers/types").TTSProvider;
    log?: (stage: string, detail?: string) => void;
    outPath: string;
    validation?: ValidationResult;
  },
): Promise<PipelineResult> {
  const tts = opts.tts ?? selectTTSProvider();
  const log = opts.log ?? (() => {});
  const outPath = opts.outPath;
  const validation = opts.validation ?? validatePlan(plan);
  plan = validation.plan;

  // 5) Narration synthesis (silent-timed fallback by default). --------------
  log("tts", tts.name);
  const totalSec = plan.format.duration_sec;
  const audioDir = path.join(path.dirname(outPath), "_audio");
  const narrationPath = await buildNarrationTrack(plan, tts, audioDir, totalSec);

  // 6) Music bed (procedural / optional local). -----------------------------
  const musicPath = await resolveMusic(plan, audioDir, totalSec, log);

  // 7) Render (video only -> silent temp), then mux audio. ------------------
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Resolve the Remotion entry relative to the APP directory. In the packaged
  // desktop app the process CWD is the executable's folder (not the app root),
  // so we use SD_APP_DIR (set by Electron) when present, else process.cwd().
  const appDir = process.env.SD_APP_DIR || process.cwd();
  const serveUrl = await bundle({ entryPoint: path.join(appDir, "remotion", "index.ts") });
  const silentVideo = path.join(path.dirname(outPath), "_video_silent.mp4");

  // Low-memory render options for small/free hosts (e.g. Render free tier).
  // Fewer parallel Chromium tabs + memory-friendly flags avoid OOM/stalls.
  const renderConcurrency = Number(process.env.RENDER_MEDIA_CONCURRENCY) || 1;
  // GL backend: let Remotion pick by default (safest across environments).
  // Override with RENDER_GL=swangle|angle|egl|swiftshader if a host needs it.
  const glEnv = process.env.RENDER_GL;
  const chromiumOptions = {
    ...(glEnv ? { gl: glEnv as "swangle" | "angle" | "egl" | "swiftshader" } : {}),
    headless: true,
  };
  const commonRender = {
    serveUrl,
    concurrency: renderConcurrency,
    chromiumOptions,
    // don't fail the whole job on a slow single-frame; give it room
    timeoutInMilliseconds: 120_000,
  };

  if (clips.length === 0) {
    // No footage -> Remotion renders the full placeholder video directly.
    log("render", `placeholder backgrounds (concurrency ${renderConcurrency})`);
    const composition = await selectComposition({
      serveUrl,
      id: "Plan",
      inputProps: { plan, clipSrcMap: {}, mode: "full" },
    });
    await renderMedia({
      ...commonRender,
      composition,
      codec: "h264",
      outputLocation: silentVideo,
      inputProps: { plan, clipSrcMap: {}, mode: "full" },
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
      ...commonRender,
      composition,
      codec: "prores", // ProRes 4444 keeps the alpha channel
      proResProfile: "4444",
      pixelFormat: "yuva444p10le",
      imageFormat: "png", // required for transparent frames
      outputLocation: overlayPath,
      inputProps: { plan, clipSrcMap: {}, mode: "overlay" },
    });

    log("composite", "FFmpeg: user footage + overlay");
    await compositeWithFootage(plan, clips, overlayPath, silentVideo, log);
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

  // 9) Thumbnail (single still) — reuses the same Remotion bundle. ----------
  log("thumbnail");
  let thumbnailPath: string | null = path.join(path.dirname(outPath), "thumbnail.png");
  try {
    const still = await selectComposition({ serveUrl, id: "Thumbnail", inputProps: { plan } });
    await renderStill({
      composition: still,
      serveUrl,
      output: thumbnailPath,
      inputProps: { plan },
      imageFormat: "png",
    });
  } catch (e) {
    console.warn(`[thumbnail] failed: ${(e as Error).message}`);
    thumbnailPath = null;
  }

  log("done", outPath);
  return { outPath, thumbnailPath, plan, validation };
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
  log: (stage: string, detail?: string) => void = () => {},
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
  const n = plan.timeline.length;
  for (let i = 0; i < plan.timeline.length; i++) {
    log("composite", `${i + 1}/${n}`);
    const scene = plan.timeline[i];
    const dur = Math.max(0.1, scene.end - scene.start);
    const clip = clips[i % clips.length];
    const seg = path.join(tmpDir, `seg_${i}.mp4`);
    // loop the source so short clips fill the scene; scale+crop to WxH; drop audio
    await pexec(ffmpegPath(), [
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
  await pexec(ffmpegPath(), ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", bgPath]);

  // 3) overlay the transparent Remotion layer on top of the footage bg
  await pexec(ffmpegPath(), [
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
