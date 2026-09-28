/**
 * Central ffmpeg / ffprobe binary resolver.
 *
 * Resolution order:
 *  1. Explicit env override (FFMPEG_PATH / FFPROBE_PATH).
 *  2. Bundled static binaries (ffmpeg-static / ffprobe-static) — used in the
 *     desktop (Electron) build so no system install is needed. In a packaged
 *     app the path lives under app.asar.unpacked, so we rewrite it.
 *  3. Plain "ffmpeg" / "ffprobe" on PATH — used by the web / Docker build.
 */
import fs from "node:fs";

function unpacked(p: string | null | undefined): string | null {
  if (!p) return null;
  // In a packaged Electron app, native binaries are unpacked next to the asar.
  const fixed = p.replace("app.asar", "app.asar.unpacked");
  if (fs.existsSync(fixed)) return fixed;
  if (fs.existsSync(p)) return p;
  return null;
}

function tryRequire(mod: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const v = require(mod);
    // ffmpeg-static exports a string path; ffprobe-static exports { path }.
    const p = typeof v === "string" ? v : v?.path;
    return unpacked(p);
  } catch {
    return null;
  }
}

let _ffmpeg: string | null = null;
let _ffprobe: string | null = null;

export function ffmpegPath(): string {
  if (_ffmpeg) return _ffmpeg;
  _ffmpeg = process.env.FFMPEG_PATH || tryRequire("ffmpeg-static") || "ffmpeg";
  return _ffmpeg;
}

export function ffprobePath(): string {
  if (_ffprobe) return _ffprobe;
  _ffprobe = process.env.FFPROBE_PATH || tryRequire("ffprobe-static") || "ffprobe";
  return _ffprobe;
}
