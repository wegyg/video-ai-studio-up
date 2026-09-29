/**
 * 사용자 명령 (단축키, 툴바 버튼이 함께 쓴다).
 */
import { ko } from './i18n/ko';
import { toast } from './ui/toasts';
import { clipEnd, createMediaClip, createShapeClip, createTextClip, DEFAULT_TRANSFORM, defaultTrackFor, findClip, isMedia, trackKindFor } from './model/ops';
import { NEUTRAL_ADJUST, presetFilter } from './model/filters';
import { keyOffsets, setEaseAt, setValues, toggleKeys, TRANSFORM_PROPS } from './model/keyframes';
import {
  cutsOf,
  maxTransitionFrames,
  TRANSITION_DEFAULT,
  TRANSITION_MIN,
  transitionInto,
  type Cut,
} from './model/transitions';
import { RATIO_SIZE, type AssetMeta, type Clip, type ColorAdjust, type EditState, type Easing, type KeyProp, type MediaClip, type Ratio, type ShapeKind, type TextStyle, type Track, type TransitionKind } from './model/types';
import { SAFE_AREA } from './engine/text';
import { history } from './store/history';
import { useProject } from './store/project';
import { useUI } from './store/ui';

const covers = (c: Clip, frame: number) => c.start < frame && frame < clipEnd(c);

/** 플레이헤드에서 분할할 클립: 선택 클립 → 선택 클립 트랙의 플레이헤드 아래 클립 → 메인 영상 트랙 → 아무 트랙 */
export function splitTarget(edit: EditState, selectedId: string | null, frame: number): string | null {
  const sel = selectedId ? findClip(edit, selectedId) : null;
  if (sel && covers(sel.clip, frame)) return sel.clip.id;
  const onTrack = (trackId: string | undefined) =>
    edit.tracks.find((t) => t.id === trackId)?.clips.find((c) => covers(c, frame))?.id ?? null;
  return (
    (sel && onTrack(sel.track.id)) ||
    onTrack(defaultTrackFor(edit, 'video')?.id) ||
    edit.tracks.flatMap((t) => t.clips).find((c) => covers(c, frame))?.id ||
    null
  );
}

/** 실행 취소 뒤 선택한 클립이 없어졌으면 선택을 푼다 */
function fixSelection(): void {
  const { selectedClipId, selectedTransition, select, selectTransition } = useUI.getState();
  const edit = useProject.getState().edit;
  if (selectedClipId && !findClip(edit, selectedClipId)) select(null);
  if (selectedTransition) {
    const loc = findClip(edit, selectedTransition);
    if (!loc || !transitionInto(loc.track, selectedTransition)) selectTransition(null);
  }
}

/**
 * 오버레이를 얹을 트랙: 메인(맨 아래) 영상 트랙이 아닌 가장 위 영상 트랙. 없으면 새로 만든다 (R18)
 */
function overlayTrack(): Track | null {
  const find = () => {
    const video = useProject.getState().edit.tracks.filter((t) => t.kind === 'video');
    return video.length > 1 ? video[0] : null;
  };
  if (!find()) useProject.getState().addTrack('video');
  return find();
}

/** 로고·화면 속 화면 기본 배치: 오른쪽 위(쇼츠 위쪽 UI에 가리지 않는 곳), 사진 30% · 영상 40% */
function overlayTransform(asset: AssetMeta, ratio: Ratio) {
  const { width: W, height: H } = RATIO_SIZE[ratio];
  const scale = asset.kind === 'video' ? 0.4 : 0.3;
  const sw = asset.width ?? W;
  const sh = asset.height ?? H;
  const fit = Math.min(W / sw, H / sh);
  const bw = sw * fit * scale;
  const bh = sh * fit * scale;
  return {
    x: Math.round(W / 2 - W * 0.05 - bw / 2),
    y: Math.round(-H / 2 + H * SAFE_AREA.top + bh / 2),
    scale,
    rotation: 0,
    opacity: 1,
  };
}

/** 이 트랙에서 toClipId로 들어가는 경계 */
function findCut(edit: EditState, trackId: string, toClipId: string): { track: Track; cut: Cut } | null {
  const track = edit.tracks.find((t) => t.id === trackId);
  const cut = track ? cutsOf(track).find((c) => c.to.id === toClipId) : undefined;
  return track && cut ? { track, cut } : null;
}

/** 트랜지션을 넣을 경계: 고른 클립의 앞 → 뒤 경계, 없으면 플레이헤드에서 가장 가까운 경계 */
function targetCut(edit: EditState): { track: Track; cut: Cut } | null {
  const { selectedClipId, selectedTransition, playhead } = useUI.getState();
  const id = selectedTransition ?? selectedClipId;
  const loc = id ? findClip(edit, id) : null;
  if (loc && loc.track.kind === 'video') {
    const cuts = cutsOf(loc.track);
    const cut = cuts.find((c) => c.to.id === loc.clip.id) ?? cuts.find((c) => c.from.id === loc.clip.id);
    if (cut) return { track: loc.track, cut };
  }
  let best: { track: Track; cut: Cut } | null = null;
  for (const track of edit.tracks) {
    if (track.kind !== 'video') continue;
    for (const cut of cutsOf(track)) {
      if (!best || Math.abs(cut.frame - playhead) < Math.abs(best.cut.frame - playhead)) best = { track, cut };
    }
  }
  return best;
}

export const actions = {
  togglePlay(): void {
    const ui = useUI.getState();
    ui.setPlaying(!ui.playing);
  },
  pause(): void {
    useUI.getState().setPlaying(false);
  },
  stepFrames(delta: number): void {
    const ui = useUI.getState();
    if (ui.playing) ui.setPlaying(false);
    ui.setPlayhead(ui.playhead + delta);
  },
  seek(frame: number): void {
    useUI.getState().setPlayhead(frame);
  },
  /** 분할 후 선택은 왼쪽 조각에 남긴다 → "분할, 이동, 분할, 삭제"로 가운데 구간을 지울 수 있다 */
  splitAtPlayhead(): void {
    const { selectedClipId, playhead, select } = useUI.getState();
    const target = splitTarget(useProject.getState().edit, selectedClipId, playhead);
    if (!target) return;
    if (useProject.getState().splitClip(target, playhead)) select(target);
  },
  deleteSelected(): void {
    const { selectedClipId, selectedTransition, select } = useUI.getState();
    if (selectedTransition) {
      actions.removeTransition(selectedTransition);
      return;
    }
    if (!selectedClipId) return;
    useProject.getState().deleteClip(selectedClipId);
    select(null);
  },
  undo(): void {
    history.undo();
    fixSelection();
  },
  redo(): void {
    history.redo();
    fixSelection();
  },
  setRatio(ratio: Ratio): void {
    useProject.getState().setRatio(ratio);
  },
  /**
   * 선택한 영상·이미지 클립에 필터를 적용한다 (R15). presetId가 null이면 원본으로.
   * 결과가 보이도록 플레이헤드를 클립 안으로 옮긴다 (G1).
   */
  applyFilterPreset(presetId: string | null): boolean {
    const id = useUI.getState().selectedClipId;
    const loc = id ? findClip(useProject.getState().edit, id) : null;
    if (!loc || (loc.clip.type !== 'video' && loc.clip.type !== 'image')) return false;
    const filter = presetId ? presetFilter(presetId) : { preset: null, adjust: { ...NEUTRAL_ADJUST } };
    if (!filter) return false;
    useProject.getState().updateClip(loc.clip.id, (c) => ({ ...c, filter }) as Clip);
    actions.revealClip(loc.clip.id);
    return true;
  },
  /** 조정 슬라이더 하나 (프리셋을 고른 뒤에도 바꿀 수 있다) */
  setAdjust(key: keyof ColorAdjust, value: number): void {
    const id = useUI.getState().selectedClipId;
    const loc = id ? findClip(useProject.getState().edit, id) : null;
    if (!loc || (loc.clip.type !== 'video' && loc.clip.type !== 'image')) return;
    useProject.getState().updateClip(loc.clip.id, (c) => {
      if (!isMedia(c)) return c;
      const prev = c.filter ?? { preset: null, adjust: { ...NEUTRAL_ADJUST } };
      return { ...c, filter: { ...prev, adjust: { ...prev.adjust, [key]: value } } };
    });
    actions.revealClip(loc.clip.id);
  },
  /**
   * 트랜지션 넣기 (R14). 놓을 경계를 주지 않으면: 고른 클립의 앞 경계(없으면 뒤 경계),
   * 고른 클립이 없으면 플레이헤드에서 가장 가까운 경계. 이미 있으면 종류만 바꾸고 길이는 그대로 둔다.
   * 넣은 뒤 그 구간을 한 번 재생해 보여 주고(G1), 트랜지션을 선택해 속성 패널에서 바로 고칠 수 있게 한다.
   */
  applyTransition(kind: TransitionKind, at?: { trackId: string; toClipId: string }): boolean {
    const edit = useProject.getState().edit;
    const cut = at ? findCut(edit, at.trackId, at.toClipId) : targetCut(edit);
    if (!cut) {
      toast('info', ko.effects.noCut);
      return false;
    }
    const max = maxTransitionFrames(cut.track, cut.cut.to.id);
    if (max < TRANSITION_MIN) {
      toast('info', ko.effects.tooShort);
      return false;
    }
    const prev = cut.cut.to.transitionIn;
    const duration = Math.min(max, prev?.duration ?? TRANSITION_DEFAULT);
    useProject.getState().updateClip(cut.cut.to.id, (c) => ({ ...c, transitionIn: { kind, duration } }) as Clip);
    useUI.getState().selectTransition(cut.cut.to.id);
    actions.previewTransition(cut.cut.to.id);
    return true;
  },
  /** 트랜지션 구간을 앞뒤 여유를 두고 한 번 재생한 뒤, 경계(섞인 모습)로 돌아온다 */
  previewTransition(toClipId: string): void {
    const loc = findClip(useProject.getState().edit, toClipId);
    const w = loc ? transitionInto(loc.track, toClipId) : null;
    if (!w) return;
    const ui = useUI.getState();
    const PAD = 10;
    if (ui.playing) ui.setPlaying(false);
    ui.setPlayhead(Math.max(0, w.start - PAD));
    ui.setPlayRange({ end: w.end + PAD, returnTo: w.cut });
    ui.setPlaying(true);
  },
  setTransitionKind(toClipId: string, kind: TransitionKind): void {
    useProject.getState().updateClip(toClipId, (c) =>
      isMedia(c) && c.transitionIn ? ({ ...c, transitionIn: { ...c.transitionIn, kind } } as Clip) : c,
    );
  },
  /** 길이(프레임). 양쪽 클립 안에 들어가게 줄인다 */
  setTransitionDuration(toClipId: string, frames: number): void {
    const loc = findClip(useProject.getState().edit, toClipId);
    if (!loc) return;
    const max = maxTransitionFrames(loc.track, toClipId);
    const d = Math.max(TRANSITION_MIN, Math.min(max, Math.round(frames)));
    useProject.getState().updateClip(toClipId, (c) =>
      isMedia(c) && c.transitionIn && c.transitionIn.duration !== d ? ({ ...c, transitionIn: { ...c.transitionIn, duration: d } } as Clip) : c,
    );
  },
  removeTransition(toClipId: string): void {
    useProject.getState().updateClip(toClipId, (c) => {
      if (!isMedia(c) || !c.transitionIn) return c;
      const rest: MediaClip = { ...c };
      delete rest.transitionIn;
      return rest;
    });
    if (useUI.getState().selectedTransition === toClipId) useUI.getState().selectTransition(null);
  },
  /**
   * 값 바꾸기 (속성 패널·미리보기 끌기, R16): 키프레임이 있는 속성은 플레이헤드에 키를 넣거나 고치고,
   * 없는 속성은 클립 값을 고친다 (model/keyframes.ts)
   */
  setValuesAt(clipId: string, patch: Partial<Record<KeyProp, number>>): void {
    const frame = useUI.getState().playhead;
    useProject.getState().updateClip(clipId, (c) => setValues(c, frame, patch));
  },
  /** ◆ 버튼: 플레이헤드에 키가 다 있으면 지우고, 아니면 지금 값으로 넣는다 */
  toggleKeyframe(clipId: string, props: KeyProp[]): void {
    const frame = useUI.getState().playhead;
    const loc = findClip(useProject.getState().edit, clipId);
    if (!loc || frame < loc.clip.start || frame >= clipEnd(loc.clip)) return;
    useProject.getState().updateClip(clipId, (c) => toggleKeys(c, frame, props));
  },
  /** 플레이헤드에 있는 키들의 이징 (그 키에서 다음 키까지) */
  setKeyEase(clipId: string, ease: Easing): void {
    const frame = useUI.getState().playhead;
    useProject.getState().updateClip(clipId, (c) => setEaseAt(c, frame - c.start, ease));
  },
  /** 이전/다음 키프레임으로 플레이헤드 이동 (클립 안의 키만) */
  jumpKeyframe(clipId: string, dir: -1 | 1): void {
    const loc = findClip(useProject.getState().edit, clipId);
    if (!loc) return;
    const c = loc.clip;
    const now = useUI.getState().playhead - c.start;
    const inside = keyOffsets(c).filter((f) => f >= 0 && f < c.duration);
    const f = dir < 0 ? [...inside].reverse().find((x) => x < now) : inside.find((x) => x > now);
    if (f !== undefined) actions.seek(c.start + f);
  },
  /** 재생 속도 0.25~4 (R17). 클립 길이가 바뀌고 같은 트랙의 뒤 클립이 함께 움직인다 */
  setSpeed(clipId: string, speed: number): void {
    useProject.getState().setSpeed(clipId, speed);
  },
  setKeepPitch(clipId: string, keep: boolean): void {
    useProject.getState().updateClip(clipId, (c) => (!isMedia(c) || (c.keepPitch !== false) === keep ? c : { ...c, keepPitch: keep }));
  },
  /** 화면 배치 초기화: 배치 키프레임도 지운다 */
  resetTransform(clipId: string): void {
    useProject.getState().updateClip(clipId, (c) => {
      const keys = { ...c.keyframes };
      for (const p of TRANSFORM_PROPS) delete keys[p];
      const out: Clip = { ...c, transform: { ...DEFAULT_TRANSFORM } };
      if (Object.keys(keys).length) out.keyframes = keys;
      else delete out.keyframes;
      return out;
    });
  },
  /** 사진(투명 PNG 로고)·영상을 위 트랙에 작게 얹는다 — 로고, 화면 속 화면(PIP) (R18) */
  addAssetAsOverlay(assetId: string): string | null {
    const p = useProject.getState();
    const asset = p.assets[assetId];
    if (!asset || (asset.kind !== 'image' && asset.kind !== 'video')) return null;
    const track = overlayTrack();
    if (!track) return null;
    const clip = { ...createMediaClip(asset, useUI.getState().playhead), transform: overlayTransform(asset, p.edit.ratio) };
    const id = useProject.getState().addClip(track.id, clip);
    if (id) useUI.getState().select(id);
    return id;
  },
  /** 도형 넣기 (R18): 위 영상 트랙의 플레이헤드 위치 (차 있으면 가장 가까운 빈 곳) */
  addShape(shape: ShapeKind): string | null {
    const track = overlayTrack();
    if (!track) return null;
    const id = useProject.getState().addClip(track.id, createShapeClip(shape, useUI.getState().playhead));
    if (id) useUI.getState().select(id);
    return id;
  },
  /** 텍스트 클립 추가 (R7.1). 첫 텍스트 트랙의 플레이헤드 위치에 넣고 선택한다 */
  addTextClip(style?: TextStyle): string | null {
    const p = useProject.getState();
    const track = defaultTrackFor(p.edit, 'text');
    if (!track) return null;
    const id = p.addClip(track.id, createTextClip(useUI.getState().playhead, ko.text.defaultContent, style));
    if (id) useUI.getState().select(id);
    return id;
  },
  /**
   * 스타일 프리셋 적용 (R7.6). 텍스트 클립이 선택돼 있으면 그 클립에, 없으면 새로 만든다.
   * 글자 내용·시간·위치는 건드리지 않는다.
   * 플레이헤드가 그 클립 밖에 있으면 결과가 안 보이므로 클립 안으로 옮긴다 (G1).
   */
  applyTextPreset(style: TextStyle): string | null {
    const selected = useUI.getState().selectedClipId;
    const loc = selected ? findClip(useProject.getState().edit, selected) : null;
    if (loc && loc.clip.type === 'text') {
      useProject.getState().updateClip(loc.clip.id, (c) => ({ ...c, ...structuredClone(style) }));
      actions.revealClip(loc.clip.id);
      return loc.clip.id;
    }
    return actions.addTextClip(style);
  },
  /** 플레이헤드가 클립 밖이면 클립이 보이는 첫 프레임(등장 효과가 끝난 뒤)으로 옮긴다 */
  revealClip(clipId: string): void {
    const loc = findClip(useProject.getState().edit, clipId);
    if (!loc) return;
    const c = loc.clip;
    const ui = useUI.getState();
    if (ui.playhead >= c.start && ui.playhead < clipEnd(c)) return;
    const settle = c.type === 'text' && c.animIn.type !== 'none' ? c.animIn.duration : 0;
    ui.setPlayhead(Math.min(clipEnd(c) - 1, c.start + settle));
  },
  /**
   * 텍스트 애니메이션을 고르면 그 부분만 한 번 재생해 보여 준다 (G1: 설명 없이 바로 결과가 보이게).
   * 끝나면 원래 보던 위치로 돌아간다.
   */
  previewTextAnim(clipId: string, which: 'in' | 'out'): void {
    const loc = findClip(useProject.getState().edit, clipId);
    if (!loc || loc.clip.type !== 'text') return;
    const c = loc.clip;
    const anim = which === 'in' ? c.animIn : c.animOut;
    if (anim.type === 'none' || anim.duration <= 0) {
      actions.revealClip(clipId);
      return;
    }
    const ui = useUI.getState();
    const HOLD = 9; // 효과가 끝난 모습을 0.3초 더 보여 준다
    const returnTo = ui.playhead >= c.start && ui.playhead < clipEnd(c) ? ui.playhead : c.start + (which === 'in' ? anim.duration : 0);
    const start = which === 'in' ? c.start : Math.max(c.start, clipEnd(c) - anim.duration - HOLD);
    const end = which === 'in' ? Math.min(clipEnd(c), c.start + anim.duration + HOLD) : clipEnd(c);
    if (ui.playing) ui.setPlaying(false);
    ui.setPlayhead(start);
    ui.setPlayRange({ end, returnTo });
    ui.setPlaying(true);
  },
  /**
   * 미디어를 타임라인에 넣는다 (R4.5). 트랙을 주지 않으면 기본 트랙(영상/이미지 → 메인 영상 트랙),
   * 위치를 주지 않으면 플레이헤드. 겹치면 가장 가까운 빈 구간. 종류가 맞지 않는 트랙이면 넣지 않는다.
   */
  addAssetToTimeline(assetId: string, trackId?: string, frame?: number): string | null {
    const p = useProject.getState();
    const asset = p.assets[assetId];
    if (!asset) return null;
    const track = trackId ? p.edit.tracks.find((t) => t.id === trackId) : defaultTrackFor(p.edit, asset.kind);
    if (!track || track.kind !== trackKindFor(asset.kind)) return null;
    const id = p.addClip(track.id, createMediaClip(asset, frame ?? useUI.getState().playhead));
    if (id) useUI.getState().select(id);
    return id;
  },
};
