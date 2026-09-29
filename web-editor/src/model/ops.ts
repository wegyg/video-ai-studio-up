/**
 * 편집 연산 (순수 함수). 입력 EditState를 바꾸지 않고 새 상태를 돌려준다.
 * 아무것도 바뀌지 않으면 **같은 객체**를 돌려준다 → 실행 취소 기록에 빈 항목이 생기지 않는다.
 */
import { shiftKeyframes } from './keyframes';
import { TEXT_STYLE_BASE } from './text-presets';
import {
  FPS,
  type AssetMeta,
  type Clip,
  type EditState,
  type MediaClip,
  type Ratio,
  type TextClip,
  type TextStyle,
  type Track,
  type TrackKind,
  type Transform,
} from './types';

export const IMAGE_DEFAULT_FRAMES = 5 * FPS;
export const TEXT_DEFAULT_FRAMES = 3 * FPS;
export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

export const clipEnd = (c: { start: number; duration: number }): number => c.start + c.duration;
export const trackKindFor = (type: Clip['type']): TrackKind =>
  type === 'text' ? 'text' : type === 'audio' ? 'audio' : 'video';
export const isMedia = (c: Clip): c is MediaClip => c.type !== 'text';
/** 원본 길이 제한이 있는 클립 (영상, 오디오) */
export const isSourced = (c: Clip): c is MediaClip => c.type === 'video' || c.type === 'audio';

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

const byStart = (a: Clip, b: Clip) => a.start - b.start;

export interface TrackNames {
  text: string;
  video: (n: number) => string;
  audio: (n: number) => string;
}

/** 기본 트랙: 텍스트, 영상 2, 영상 1(메인), 오디오 1 (위→아래) */
export function createEditState(ratio: Ratio, names: TrackNames): EditState {
  const track = (kind: TrackKind, name: string): Track => ({ id: newId('track'), kind, name, muted: false, clips: [] });
  return {
    ratio,
    tracks: [track('text', names.text), track('video', names.video(2)), track('video', names.video(1)), track('audio', names.audio(1))],
  };
}

export function createMediaClip(asset: AssetMeta, start: number): MediaClip {
  const duration = asset.kind === 'image' ? IMAGE_DEFAULT_FRAMES : Math.max(1, asset.durationFrames ?? 1);
  return {
    id: newId('clip'),
    type: asset.kind,
    assetId: asset.id,
    start: Math.max(0, Math.round(start)),
    duration,
    inPoint: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    transform: { ...DEFAULT_TRANSFORM },
  };
}

/** 기본 등장·퇴장 애니메이션 길이(프레임) */
export const TEXT_ANIM_FRAMES = 12;

export function createTextClip(start: number, text: string, style: TextStyle = TEXT_STYLE_BASE): TextClip {
  return {
    id: newId('clip'),
    type: 'text',
    start: Math.max(0, Math.round(start)),
    duration: TEXT_DEFAULT_FRAMES,
    text,
    ...structuredClone(style),
    // 기본은 애니메이션 없음: 추가한 순간(첫 프레임)부터 글자가 보여야 한다.
    // 페이드로 시작하면 첫 프레임이 투명이라 "눌렀는데 아무것도 안 보이는" 상태가 된다 (G1)
    animIn: { type: 'none', duration: TEXT_ANIM_FRAMES },
    animOut: { type: 'none', duration: TEXT_ANIM_FRAMES },
    transform: { ...DEFAULT_TRANSFORM },
  };
}

export interface ClipLocation {
  track: Track;
  trackIndex: number;
  clip: Clip;
  clipIndex: number;
}

export function findClip(edit: EditState, clipId: string): ClipLocation | null {
  for (let ti = 0; ti < edit.tracks.length; ti++) {
    const track = edit.tracks[ti];
    const ci = track.clips.findIndex((c) => c.id === clipId);
    if (ci >= 0) return { track, trackIndex: ti, clip: track.clips[ci], clipIndex: ci };
  }
  return null;
}

/** 클립을 새로 넣을 기본 트랙: 영상/이미지 → 맨 아래 영상 트랙(메인), 오디오 → 첫 오디오 트랙, 텍스트 → 첫 텍스트 트랙 */
export function defaultTrackFor(edit: EditState, type: Clip['type']): Track | undefined {
  const kind = trackKindFor(type);
  const candidates = edit.tracks.filter((t) => t.kind === kind);
  return kind === 'video' ? candidates[candidates.length - 1] : candidates[0];
}

function replaceTrack(edit: EditState, track: Track): EditState {
  return { ...edit, tracks: edit.tracks.map((t) => (t.id === track.id ? track : t)) };
}

/**
 * 겹치지 않는 가장 가까운 시작 프레임. 트랙 끝 뒤는 항상 비어 있으므로 결과는 항상 있다.
 * clips에는 대상 클립 자신을 빼고 넘긴다.
 */
export function freeStart(clips: readonly Clip[], duration: number, preferred: number): number {
  const want = Math.max(0, Math.round(preferred));
  let best = want;
  let bestDist = Infinity;
  const consider = (gs: number, ge: number) => {
    if (ge - gs < duration) return;
    const cand = Math.min(Math.max(want, gs), ge - duration);
    const dist = Math.abs(cand - want);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  };
  let gapStart = 0;
  for (const c of [...clips].sort(byStart)) {
    consider(gapStart, c.start);
    gapStart = Math.max(gapStart, clipEnd(c));
  }
  consider(gapStart, Infinity);
  return best;
}

/** 클립 추가. 트랙 종류가 맞지 않으면 그대로. 겹치면 가장 가까운 빈 구간에 넣는다. */
export function addClip(edit: EditState, trackId: string, clip: Clip): EditState {
  const track = edit.tracks.find((t) => t.id === trackId);
  if (!track || track.kind !== trackKindFor(clip.type)) return edit;
  const start = freeStart(track.clips, clip.duration, clip.start);
  return replaceTrack(edit, { ...track, clips: [...track.clips, { ...clip, start }].sort(byStart) });
}

/** 이동 (R5.1, R5.6). 다른 종류 트랙으로는 옮기지 않는다. */
export function moveClip(edit: EditState, clipId: string, toTrackId: string, toStart: number): EditState {
  const loc = findClip(edit, clipId);
  const target = edit.tracks.find((t) => t.id === toTrackId);
  if (!loc || !target || target.kind !== trackKindFor(loc.clip.type)) return edit;
  const others = target.clips.filter((c) => c.id !== clipId);
  const start = freeStart(others, loc.clip.duration, toStart);
  if (start === loc.clip.start && target.id === loc.track.id) return edit;
  const moved: Clip = { ...loc.clip, start };
  return {
    ...edit,
    tracks: edit.tracks.map((t) => {
      if (t.id === target.id) return { ...t, clips: [...others, moved].sort(byStart) };
      if (t.id === loc.track.id) return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
      return t;
    }),
  };
}

function clampFades<T extends Clip>(c: T): T {
  if (!isMedia(c)) return c;
  const fadeIn = Math.min(c.fadeIn, c.duration);
  const fadeOut = Math.min(c.fadeOut, c.duration);
  return fadeIn === c.fadeIn && fadeOut === c.fadeOut ? c : { ...c, fadeIn, fadeOut };
}

/**
 * 트림 (R5.2). edge='start'면 시작을, 'end'면 끝을 frame으로 옮긴다.
 * - 최소 길이 1프레임, 이웃 클립과 겹치지 않음
 * - 영상/오디오는 원본 범위(0 ≤ inPoint, inPoint+duration ≤ 원본 길이)를 넘지 않음
 * - 이미지/텍스트는 길이 제한 없음
 */
export function trimClip(
  edit: EditState,
  assets: Record<string, AssetMeta>,
  clipId: string,
  edge: 'start' | 'end',
  frame: number,
): EditState {
  const loc = findClip(edit, clipId);
  if (!loc) return edit;
  const c = loc.clip;
  const others = loc.track.clips.filter((x) => x.id !== clipId);
  const target = Math.round(frame);
  let next: Clip;
  if (edge === 'start') {
    const end = clipEnd(c);
    let min = 0;
    for (const o of others) if (o.start < c.start) min = Math.max(min, clipEnd(o));
    if (isSourced(c)) min = Math.max(min, c.start - c.inPoint);
    const start = Math.min(Math.max(target, min), end - 1);
    if (start === c.start) return edit;
    const delta = start - c.start;
    next = isSourced(c)
      ? { ...c, start, duration: end - start, inPoint: c.inPoint + delta }
      : { ...c, start, duration: end - start };
    // 키프레임은 타임라인의 같은 순간에 남는다 (클립 기준 시각이 delta만큼 당겨진다)
    if (c.keyframes) next = { ...next, keyframes: shiftKeyframes(c.keyframes, -delta) };
  } else {
    let max = Infinity;
    for (const o of others) if (o.start > c.start) max = Math.min(max, o.start);
    if (isSourced(c)) {
      const src = assets[c.assetId]?.durationFrames;
      if (src !== undefined) max = Math.min(max, c.start + (src - c.inPoint));
    }
    const end = Math.min(Math.max(target, c.start + 1), max);
    if (end === clipEnd(c)) return edit;
    next = { ...c, duration: end - c.start };
  }
  next = clampFades(next);
  return replaceTrack(edit, { ...loc.track, clips: loc.track.clips.map((x) => (x.id === clipId ? next : x)) });
}

/**
 * 분할 (R5.3). at 프레임에서 두 클립으로 나눈다. 오른쪽 클립은 원본의 해당 지점부터 재생한다.
 * 페이드 인은 왼쪽에, 페이드 아웃은 오른쪽에만 남긴다. 클립 가장자리나 밖이면 그대로.
 */
export function splitClip(edit: EditState, clipId: string, at: number): { edit: EditState; rightId: string | null } {
  const loc = findClip(edit, clipId);
  if (!loc) return { edit, rightId: null };
  const c = loc.clip;
  const cut = Math.round(at);
  if (cut <= c.start || cut >= clipEnd(c)) return { edit, rightId: null };
  const leftDur = cut - c.start;
  const rightDur = clipEnd(c) - cut;
  const rightId = newId('clip');
  let left: Clip;
  let right: Clip;
  if (isMedia(c)) {
    left = { ...c, duration: leftDur, fadeIn: Math.min(c.fadeIn, leftDur), fadeOut: 0 };
    right = {
      ...c,
      id: rightId,
      start: cut,
      duration: rightDur,
      inPoint: c.type === 'image' ? c.inPoint : c.inPoint + leftDur,
      fadeIn: 0,
      fadeOut: Math.min(c.fadeOut, rightDur),
    };
    // 들어오는 트랜지션은 왼쪽 조각에만 남는다 (새로 생긴 자른 자리에는 없다)
    delete (right as MediaClip).transitionIn;
  } else {
    left = { ...c, duration: leftDur };
    right = { ...c, id: rightId, start: cut, duration: rightDur };
  }
  // 오른쪽 조각도 키를 모두 가진다 (기준 시각만 옮김) → 자른 곳에서도 값이 이어진다
  if (c.keyframes) right = { ...right, keyframes: shiftKeyframes(c.keyframes, -leftDur) };
  const clips = loc.track.clips.flatMap((x) => (x.id === clipId ? [left, right] : [x]));
  return { edit: replaceTrack(edit, { ...loc.track, clips }), rightId };
}

/** 이 미디어를 쓰는 클립을 모두 지운다 (미디어 목록에서 삭제할 때) */
export function removeAssetClips(edit: EditState, assetId: string): EditState {
  let changed = false;
  const tracks = edit.tracks.map((t) => {
    const clips = t.clips.filter((c) => c.type === 'text' || c.assetId !== assetId);
    if (clips.length === t.clips.length) return t;
    changed = true;
    return { ...t, clips };
  });
  return changed ? { ...edit, tracks } : edit;
}

/** 삭제 (R5.4) */
export function deleteClip(edit: EditState, clipId: string): EditState {
  const loc = findClip(edit, clipId);
  if (!loc) return edit;
  return replaceTrack(edit, { ...loc.track, clips: loc.track.clips.filter((c) => c.id !== clipId) });
}

/** 시간 외 속성 변경 (위치/크기/볼륨/텍스트 서식 등). fn이 같은 객체를 돌려주면 그대로. */
export function updateClip(edit: EditState, clipId: string, fn: (c: Clip) => Clip): EditState {
  const loc = findClip(edit, clipId);
  if (!loc) return edit;
  const next = fn(loc.clip);
  if (next === loc.clip) return edit;
  const fixed: Clip = { ...next, id: loc.clip.id, start: loc.clip.start, duration: loc.clip.duration };
  return replaceTrack(edit, { ...loc.track, clips: loc.track.clips.map((c) => (c.id === clipId ? clampFades(fixed) : c)) });
}

/** 트랙 추가: 영상 트랙은 가장 위 영상 트랙 위에, 오디오는 맨 아래, 텍스트는 맨 위 */
export function addTrack(edit: EditState, kind: TrackKind, name: string): EditState {
  const track: Track = { id: newId('track'), kind, name, muted: false, clips: [] };
  const tracks = [...edit.tracks];
  if (kind === 'video') {
    const i = tracks.findIndex((t) => t.kind === 'video');
    tracks.splice(i < 0 ? tracks.length : i, 0, track);
  } else if (kind === 'audio') {
    tracks.push(track);
  } else {
    tracks.unshift(track);
  }
  return { ...edit, tracks };
}

export function setTrackMuted(edit: EditState, trackId: string, muted: boolean): EditState {
  const track = edit.tracks.find((t) => t.id === trackId);
  if (!track || track.muted === muted) return edit;
  return replaceTrack(edit, { ...track, muted });
}
