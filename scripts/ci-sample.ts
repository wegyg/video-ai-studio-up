/**
 * CI smoke test (used by the Windows GitHub Actions workflow).
 *
 * Exercises the SAME code paths the desktop app uses — but headless, with no
 * GUI — so a green run proves the app can actually generate a video on Windows:
 *   1. extractBrief() on the real reference URL (feature 4)
 *   2. runPipeline() -> plan -> render -> MP4 (features 1-3 core render path)
 *   3. ffprobe the output MP4 and assert: exists, >0 bytes, has a video stream,
 *      duration ~= requested (±3s). Audio is optional (silent TTS fallback).
 *
 * Usage: npx tsx scripts/ci-sample.ts [outPath] [durationSec] [referenceUrl]
 * Exits non-zero (fails the workflow) on any failed assertion.
 */
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runPipeline } from "../src/pipeline";
import { extractBrief } from "../src/brief";
import { ffprobePath } from "../src/ffmpeg";

const pexec = promisify(execFile);

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve("out/ci-sample.mp4");
const DURATION = Number(process.argv[3]) || 15;
const REFERENCE = process.argv[4] || "https://www.bodycenter.kr";
const BRIEF = "몸의중심 체형교정센터를 소개하는 세로형 광고 영상";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

async function ffprobeJson(file: string): Promise<any> {
  const { stdout } = await pexec(ffprobePath(), [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  return JSON.parse(stdout);
}

async function main() {
  const t0 = Date.now();
  console.log(`=== ShortsDirector CI smoke test ===`);
  console.log(`reference: ${REFERENCE}`);
  console.log(`duration:  ${DURATION}s`);
  console.log(`out:       ${OUT}`);
  console.log(`ffprobe:   ${ffprobePath()}`);

  // --- Feature 4: brief extraction from the real URL ----------------------
  console.log(`\n[1/3] Extracting brief from ${REFERENCE} …`);
  const brief = await extractBrief(REFERENCE);
  console.log("brief:", JSON.stringify(brief, null, 2));
  assert(brief, "extractBrief returned a brief card");
  // The reference site should crawl successfully (not the paste fallback).
  assert(!brief.crawlFailed, "brief crawl succeeded (crawlFailed=false)");
  assert(brief.name && brief.name.length > 0, "brief has a business name (상호명)");

  // --- Features 1-3: full pipeline render ---------------------------------
  console.log(`\n[2/3] Rendering ${DURATION}s sample video …`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const result = await runPipeline(
    {
      brief: BRIEF,
      reference: REFERENCE,
      clipPaths: [], // no footage -> placeholder backgrounds (deterministic, CI-friendly)
      ratio: "9:16",
      durationSec: DURATION,
      fps: 30,
      outPath: OUT,
    },
    {
      onProgress: (stage, detail) =>
        console.log(`   [progress] ${stage}${detail ? ` — ${detail}` : ""}`),
    },
  );
  console.log(`render complete: ${result.outPath}`);

  // --- ffprobe validation --------------------------------------------------
  console.log(`\n[3/3] Validating output with ffprobe …`);
  assert(fs.existsSync(OUT), `output file exists: ${OUT}`);
  const size = fs.statSync(OUT).size;
  assert(size > 10_000, `output file is non-trivial (${size} bytes > 10KB)`);

  const probe = await ffprobeJson(OUT);
  const streams: any[] = probe.streams || [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  assert(video, "MP4 contains a video stream");
  console.log(`   video: ${video.codec_name} ${video.width}x${video.height}`);
  assert(video.width === 1080 && video.height === 1920, "video is 1080x1920 vertical (9:16)");
  if (audio) console.log(`   audio: ${audio.codec_name} @ ${audio.sample_rate}Hz`);
  else console.log("   audio: none (silent TTS fallback — acceptable)");

  const dur = Number(probe.format?.duration || video.duration || 0);
  console.log(`   duration: ${dur.toFixed(2)}s (requested ${DURATION}s)`);
  assert(Math.abs(dur - DURATION) <= 3, `duration ~= ${DURATION}s (±3s tolerance)`);

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n🎉 CI smoke test PASSED in ${secs}s — output: ${OUT} (${size} bytes)`);
}

main().catch((e) => {
  console.error("\n❌ CI smoke test FAILED:", e);
  process.exit(1);
});
