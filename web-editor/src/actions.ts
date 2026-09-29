/**
 * 사용자 명령 (단축키, 툴바 버튼이 함께 쓴다).
 */
import { ko } from './i18n/ko';
import { clipEnd, createMediaClip, createTextClip, defaultTrackFor, findClip, trackKindFor } from './model/ops';
import { NEUTRAL_ADJUST, presetFilter } from './model/filters';
import type { Clip, ColorAdjust, EditState, Ratio, TextStyle } from './model/types';
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
  const { selectedClipId, select } = useUI.getState();
  if (selectedClipId && !findClip(useProject.getState().edit, selectedClipId)) select(null);
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
    const { selectedClipId, select } = useUI.getState();
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
      if (c.type === 'text') return c;
      const prev = c.filter ?? { preset: null, adjust: { ...NEUTRAL_ADJUST } };
      return { ...c, filter: { ...prev, adjust: { ...prev.adjust, [key]: value } } };
    });
    actions.revealClip(loc.clip.id);
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
