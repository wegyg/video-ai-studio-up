import type { AspectRatio } from "../src/schema";

export function ratioToDimensions(ratio: AspectRatio, base = 1080): { width: number; height: number } {
  if (ratio === "9:16") return { width: base, height: Math.round((base * 16) / 9) };
  if (ratio === "1:1") return { width: base, height: base };
  return { width: Math.round((base * 16) / 9), height: base }; // 16:9
}
