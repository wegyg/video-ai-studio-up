import { FPS, type EditState } from './types';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 프레임 → "mm:ss.ff" (ff = 초 안의 프레임 번호 00~29) */
export function formatTimecode(frames: number, fps: number = FPS): string {
  const f = Math.max(0, Math.round(frames));
  const totalSec = Math.floor(f / fps);
  return `${pad2(Math.floor(totalSec / 60))}:${pad2(totalSec % 60)}.${pad2(f % fps)}`;
}

export const secondsToFrames = (s: number): number => Math.round(s * FPS);
export const framesToSeconds = (f: number): number => f / FPS;

/** 프로젝트 전체 길이 = 가장 늦게 끝나는 클립의 끝 프레임 */
export function editDuration(edit: EditState): number {
  let end = 0;
  for (const t of edit.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.duration);
  return end;
}
