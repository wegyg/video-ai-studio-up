/** 스냅(자석): 드래그/트림 중인 가장자리를 가까운 기준점에 붙인다. 기준점 = 다른 클립 가장자리, 플레이헤드, 0. */
import type { EditState } from './types';

export const SNAP_THRESHOLD_PX = 8;

/** 기준점 목록 (제외할 클립의 가장자리는 빼고) */
export function snapCandidates(edit: EditState, excludeClipId: string | null, playhead: number): number[] {
  const set = new Set<number>([0, Math.round(playhead)]);
  for (const t of edit.tracks) {
    for (const c of t.clips) {
      if (c.id === excludeClipId) continue;
      set.add(c.start);
      set.add(c.start + c.duration);
    }
  }
  return [...set];
}

export interface SnapResult {
  value: number;
  /** 달라붙은 기준점 (없으면 null) — 스냅선 표시용 */
  target: number | null;
}

/** 한 지점 스냅. threshold는 프레임 단위 (= 8px / pxPerFrame). */
export function snapValue(value: number, candidates: readonly number[], threshold: number): SnapResult {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - value);
    if (d <= threshold && d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best === null ? { value, target: null } : { value: best, target: best };
}

/** 클립 이동 스냅: 시작과 끝 중 더 가까이 붙는 쪽을 쓴다. 반환값은 새 시작 프레임. */
export function snapRange(start: number, duration: number, candidates: readonly number[], threshold: number): SnapResult {
  const a = snapValue(start, candidates, threshold);
  const b = snapValue(start + duration, candidates, threshold);
  const da = a.target === null ? Infinity : Math.abs(a.value - start);
  const db = b.target === null ? Infinity : Math.abs(b.value - (start + duration));
  if (da === Infinity && db === Infinity) return { value: start, target: null };
  return da <= db ? { value: a.value, target: a.target } : { value: b.value - duration, target: b.target };
}
