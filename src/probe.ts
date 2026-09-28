/** ffprobe helpers for inspecting uploaded footage. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ffprobePath } from "./ffmpeg";

const pexec = promisify(execFile);

export async function probeClip(path: string): Promise<{ durationSec: number; width: number; height: number }> {
  try {
    const { stdout } = await pexec(ffprobePath(), [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "json",
      path,
    ]);
    const data = JSON.parse(stdout);
    const stream = (data.streams && data.streams[0]) || {};
    return {
      durationSec: parseFloat(data.format?.duration ?? "0") || 0,
      width: stream.width ?? 0,
      height: stream.height ?? 0,
    };
  } catch {
    return { durationSec: 0, width: 0, height: 0 };
  }
}
