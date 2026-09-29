/**
 * 사용자 명령 (단축키, 툴바 버튼이 함께 쓴다).
 */
import { clipEnd, defaultTrackFor, findClip } from './model/ops';
import type { Clip, EditState, Ratio } from './model/types';
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
};
