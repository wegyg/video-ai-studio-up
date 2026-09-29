/**
 * "한 편 만드는 데 걸린 시간" 재기 (완료 기준 G5).
 * 프로젝트를 처음 만든 뒤 편집기를 켜 놓고 실제로 작업한 시간을 더한다.
 * 탭을 켜 두고 자리를 비운 시간은 빼려고, 마지막 조작에서 2분이 지나면 세지 않는다.
 */
const IDLE_MS = 2 * 60 * 1000;
const KEY = 'workMs';

let workMs = 0;
let lastActive = 0;
let projectId = '';

export function loadWorkTime(id: string, saved: number): void {
  projectId = id;
  workMs = saved;
  lastActive = performance.now();
}

/** 사용자가 무언가 했을 때 호출 */
export function markActive(): void {
  const now = performance.now();
  if (lastActive) {
    const delta = now - lastActive;
    if (delta < IDLE_MS) workMs += delta;
  }
  lastActive = now;
}

export const workElapsedMs = (): number => workMs;
export const workElapsedMinutes = (): number => Math.max(1, Math.round(workMs / 60000));
export const workTimeKey = KEY;
export const workProjectId = (): string => projectId;
