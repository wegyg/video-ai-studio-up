/**
 * 트랜지션 계산 (R14). 미리보기·내보내기·타임라인 표시가 모두 이 파일을 쓴다.
 *
 * - 같은 영상 트랙에서 맞닿은 두 클립(앞 클립 끝 = 뒤 클립 시작) 사이에만 넣는다. 뒤 클립의 `transitionIn`에 저장한다.
 * - 경계를 가운데 두고 앞 클립 쪽으로 floor(d/2), 뒤 클립 쪽으로 나머지 프레임에 걸친다.
 *   **타임라인 길이와 다른 클립 위치는 바뀌지 않는다** (자막·BGM이 영상과 어긋나지 않게).
 * - 구간 안에서 자기 범위 밖을 보여야 하는 클립은 원본의 앞뒤 여분(자르고 남은 부분)을 쓰고,
 *   여분이 없으면 첫/마지막 프레임을 멈춰 보여 준다.
 * - 길이는 양쪽 클립 안에 들어가야 하고, 한 클립 양쪽 트랜지션끼리 겹치지 않는다.
 * - 저장된 값이 조건을 벗어나도(드래그 중 등) 여기서 계산한 "실제 구간"만 쓰므로 화면은 항상 일관된다.
 */
import type { Clip, EditState, MediaClip, Track, TransitionKind } from './types';

/** 셰이더(src/engine/gl/effects.ts의 FS_TRANSITION)의 u_kind 번호 순서와 같다 */
export const TRANSITION_KINDS: TransitionKind[] = [
  'dissolve',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'zoom-in',
  'zoom-out',
  'wipe',
  'blur',
  'shake',
  'glitch',
];

/** 기본 0.5초, 최소 0.1초, 최대 2초 (프레임) */
export const TRANSITION_DEFAULT = 15;
export const TRANSITION_MIN = 3;
export const TRANSITION_MAX = 60;

/** 타임라인 프레임 → 원본 프레임 (속도 반영, 소수 가능. 범위를 자르지 않는다) */
export const srcAt = (clip: Pick<MediaClip, 'inPoint' | 'start' | 'speed'>, frame: number): number =>
  clip.inPoint + (frame - clip.start) * (clip.speed || 1);

export const isVisualClip = (c: Clip | undefined | null): c is MediaClip => !!c && (c.type === 'video' || c.type === 'image');

/** 경계 앞(앞 클립 안)에 걸치는 프레임 수 */
export const beforeCut = (d: number): number => Math.floor(d / 2);
/** 경계 뒤(뒤 클립 안)에 걸치는 프레임 수 */
export const afterCut = (d: number): number => d - Math.floor(d / 2);

/** floor(d/2) ≤ a, ceil(d/2) ≤ b를 만족하는 가장 긴 d (최대 TRANSITION_MAX) */
function fit(a: number, b: number): number {
  if (a < 0 || b <= 0) return 0;
  return Math.min(TRANSITION_MAX, a >= b ? 2 * b : 2 * a + 1);
}

export interface TransitionWindow {
  from: MediaClip;
  to: MediaClip;
  kind: TransitionKind;
  /** 실제 길이 (저장값을 조건에 맞게 줄인 값) */
  duration: number;
  /** 경계 프레임 (= to.start) */
  cut: number;
  /** 구간 [start, end) */
  start: number;
  end: number;
}

export interface Cut {
  frame: number;
  from: MediaClip;
  to: MediaClip;
}

const cutsCache = new WeakMap<Track, Cut[]>();
/** 맞닿은 두 영상·이미지 클립 사이의 경계들 (트랙 순서대로) */
export function cutsOf(track: Track): Cut[] {
  let out = cutsCache.get(track);
  if (!out) {
    out = [];
    if (track.kind === 'video') {
      for (let i = 1; i < track.clips.length; i++) {
        const a = track.clips[i - 1];
        const b = track.clips[i];
        if (isVisualClip(a) && isVisualClip(b) && a.start + a.duration === b.start) out.push({ frame: b.start, from: a, to: b });
      }
    }
    cutsCache.set(track, out);
  }
  return out;
}

const windowsCache = new WeakMap<Track, TransitionWindow[]>();
/**
 * 이 트랙에서 실제로 보이는 트랜지션 구간들. 앞에서부터 차례로 길이를 정한다:
 * 앞 클립은 자기 앞쪽 트랜지션이 쓰고 남은 부분만, 뒤 클립은 자기 길이만큼 내줄 수 있다.
 * (뒤 클립의 다음 트랜지션은 다음 차례에 "앞 클립" 조건으로 줄어들므로 서로 겹치지 않는다)
 */
export function transitionsOf(track: Track): TransitionWindow[] {
  let out = windowsCache.get(track);
  if (out) return out;
  out = [];
  const incoming = new Map<string, number>();
  for (const cut of cutsOf(track)) {
    const t = cut.to.transitionIn;
    if (!t) continue;
    const used = afterCut(incoming.get(cut.from.id) ?? 0);
    const d = Math.min(Math.round(t.duration), fit(cut.from.duration - used, cut.to.duration));
    if (d < TRANSITION_MIN) continue;
    incoming.set(cut.to.id, d);
    out.push({ from: cut.from, to: cut.to, kind: t.kind, duration: d, cut: cut.frame, start: cut.frame - beforeCut(d), end: cut.frame + afterCut(d) });
  }
  windowsCache.set(track, out);
  return out;
}

/** 이 클립으로 들어오는 실제 트랜지션 (없으면 null) */
export function transitionInto(track: Track, clipId: string): TransitionWindow | null {
  return transitionsOf(track).find((w) => w.to.id === clipId) ?? null;
}

/**
 * 이 경계(뒤 클립 = clip)에 넣을 수 있는 가장 긴 트랜지션 (프레임). 경계가 없으면 0.
 * 편집 화면의 길이 조절 상한이다 — 양쪽 이웃 트랜지션이 쓰는 부분을 빼고 계산한다.
 */
export function maxTransitionFrames(track: Track, clipId: string): number {
  const cuts = cutsOf(track);
  const i = cuts.findIndex((c) => c.to.id === clipId);
  if (i < 0) return 0;
  const cut = cuts[i];
  const wins = transitionsOf(track);
  const prevIn = wins.find((w) => w.to.id === cut.from.id)?.duration ?? 0;
  const nextOut = wins.find((w) => w.from.id === cut.to.id)?.duration ?? 0;
  return fit(cut.from.duration - afterCut(prevIn), cut.to.duration - beforeCut(nextOut));
}

/** 프레임 frame에서 이 경계와의 거리가 maxDist 프레임 이하인 가장 가까운 경계 */
export function nearestCut(track: Track, frame: number, maxDist: number): Cut | null {
  let best: Cut | null = null;
  for (const c of cutsOf(track)) {
    const d = Math.abs(c.frame - frame);
    if (d <= maxDist && (!best || d < Math.abs(best.frame - frame))) best = c;
  }
  return best;
}

export type TrackVisual =
  | { clip: MediaClip; transition: null; progress: 0 }
  /** clip: 효과를 쓸 수 없을 때 대신 보여 줄 클립 (경계 전 = 앞 클립, 경계부터 = 뒤 클립) */
  | { clip: MediaClip; transition: TransitionWindow; progress: number };

/** 프레임 frame에서 이 트랙이 보여 줄 것: 클립 하나, 또는 트랜지션(두 클립 + 진행도 0~1) */
export function visualAt(track: Track, frame: number): TrackVisual | null {
  for (const w of transitionsOf(track)) {
    if (frame >= w.start && frame < w.end) {
      return { clip: frame < w.cut ? w.from : w.to, transition: w, progress: (frame - w.start + 0.5) / w.duration };
    }
  }
  for (const c of track.clips) {
    if (c.start > frame) break;
    if (frame < c.start + c.duration) return isVisualClip(c) ? { clip: c, transition: null, progress: 0 } : null;
  }
  return null;
}

/** 트랜지션 때문에 클립이 자기 범위 밖에서도 보이는 구간 [start, end) */
export function visibleRange(track: Track, clip: Clip): { start: number; end: number } {
  let start = clip.start;
  let end = clip.start + clip.duration;
  if (isVisualClip(clip) && track.kind === 'video') {
    for (const w of transitionsOf(track)) {
      if (w.to.id === clip.id) start = w.start;
      if (w.from.id === clip.id) end = w.end;
    }
  }
  return { start, end };
}

/**
 * 타임라인 프레임에서 보여 줄 원본 프레임 번호. 원본 범위(0 ~ 원본 길이-1)를 벗어나면 끝 프레임에 멈춘다.
 * 원본 길이를 모르면 클립 자신의 범위 안으로 멈춘다(여분을 쓰지 않는다).
 */
export function sourceFrame(clip: MediaClip, frame: number, sourceFrames?: number): number {
  if (clip.type === 'image') return 0;
  const want = srcAt(clip, frame);
  const lo = sourceFrames !== undefined ? 0 : clip.inPoint;
  const hi = sourceFrames !== undefined ? Math.max(0, sourceFrames - 1) : clip.inPoint + (clip.duration - 1) * clip.speed;
  return Math.min(hi, Math.max(lo, want));
}

/**
 * 저장 상태 정리: 맞닿지 않은 클립의 트랜지션은 지우고, 너무 긴 것은 실제 길이로 줄인다.
 * 바뀐 것이 없으면 같은 객체를 돌려준다 (실행 취소 기록에 빈 항목이 생기지 않게).
 */
export function normalizeTransitions(edit: EditState): EditState {
  let changed = false;
  const tracks = edit.tracks.map((track) => {
    if (track.kind !== 'video' || !track.clips.some((c) => isVisualClip(c) && c.transitionIn)) return track;
    const real = new Map(transitionsOf(track).map((w) => [w.to.id, w.duration]));
    let trackChanged = false;
    const clips = track.clips.map((c) => {
      if (!isVisualClip(c) || !c.transitionIn) return c;
      const d = real.get(c.id);
      if (d === undefined) {
        trackChanged = true;
        const rest = { ...c };
        delete rest.transitionIn;
        return rest;
      }
      if (d === c.transitionIn.duration) return c;
      trackChanged = true;
      return { ...c, transitionIn: { ...c.transitionIn, duration: d } };
    });
    if (!trackChanged) return track;
    changed = true;
    return { ...track, clips };
  });
  return changed ? { ...edit, tracks } : edit;
}
