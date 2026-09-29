/**
 * 타임라인 드래그: 클립 이동(R5.1), 양끝 트림(R5.2), 스냅(R5.5), 가장자리 자동 스크롤.
 * 드래그 한 번 = 실행 취소 기록 1개 (history.beginGesture/endGesture). Esc로 취소.
 * 위치는 "누른 지점의 트랙 좌표"와 "지금 트랙 좌표"의 차이로 계산한다 → 자동 스크롤해도 어긋나지 않는다.
 */
import { clipEnd, findClip, isMedia, trackKindFor } from '../../model/ops';
import { snapCandidates, snapRange, snapValue, SNAP_THRESHOLD_PX } from '../../model/snap';
import type { Clip } from '../../model/types';
import { history } from '../../store/history';
import { useProject } from '../../store/project';
import { useUI } from '../../store/ui';
import { HEADER_W } from './layout';
import { useTimelineView } from './view';

export type GestureKind = 'move' | 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out';

const EDGE = 40; // 이 거리 안이면 자동 스크롤
const MOVE_SLOP = 3; // 이만큼 움직여야 이동 시작 (클릭과 구분)

interface LaneRect {
  id: string;
  kind: string;
  top: number;
  bottom: number;
}

export function startClipGesture(e: PointerEvent | React.PointerEvent, clipId: string, kind: GestureKind, scroller: HTMLElement): void {
  const loc = findClip(useProject.getState().edit, clipId);
  if (!loc) return;
  const clip: Clip = loc.clip;
  // 포인터는 스크롤 영역이 잡는다. 클립 요소는 다른 트랙으로 옮기면 React가 새로 만들기 때문에
  // 클립 요소가 잡으면 요소가 사라지는 순간 pointerup을 못 받아 제스처가 끝나지 않는다.
  const target = scroller;
  target.setPointerCapture(e.pointerId);

  const ppf = () => useUI.getState().pxPerFrame;
  const laneEl = scroller.querySelector<HTMLElement>(`[data-testid=track-lane][data-track-id="${loc.track.id}"]`)!;
  // 트랙 좌표(px) = clientX - 트랙 왼쪽 (트랙 요소는 스크롤과 함께 움직인다)
  const laneX = (clientX: number) => clientX - laneEl.getBoundingClientRect().left;
  const downX = laneX(e.clientX);
  const downY = e.clientY;
  const lanes: LaneRect[] = [...scroller.querySelectorAll<HTMLElement>('[data-testid=track-lane]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.trackId!, kind: el.dataset.kind!, top: r.top, bottom: r.bottom };
  });
  const candidates = snapCandidates(useProject.getState().edit, clipId, useUI.getState().playhead);
  const wantKind = trackKindFor(clip.type);

  // 이동만 살짝 움직여야 시작한다 (클릭과 구분). 트림·페이드는 바로 시작
  let started = kind !== 'move';
  let lastX = e.clientX;
  let lastY = e.clientY;
  let raf = 0;
  history.beginGesture();

  const apply = () => {
    const z = ppf();
    const dFrames = Math.round((laneX(lastX) - downX) / z);
    const thr = SNAP_THRESHOLD_PX / z;
    const snap = useUI.getState().snap;
    const p = useProject.getState();
    let line: number | null = null;
    if (kind === 'move') {
      let start = Math.max(0, clip.start + dFrames);
      if (snap) {
        const r = snapRange(start, clip.duration, candidates, thr);
        start = r.value;
        line = r.target;
      }
      const lane = lanes.find((l) => lastY >= l.top && lastY < l.bottom && l.kind === wantKind);
      const cur = findClip(p.edit, clipId);
      p.moveClip(clipId, lane?.id ?? cur?.track.id ?? loc.track.id, start);
    } else if (kind === 'fade-in' || kind === 'fade-out') {
      // 페이드 인 핸들은 오른쪽으로, 페이드 아웃 핸들은 왼쪽으로 끌면 길어진다 (R8.2)
      if (!isMedia(clip)) return;
      const key = kind === 'fade-in' ? 'fadeIn' : 'fadeOut';
      const start = kind === 'fade-in' ? clip.fadeIn : clip.fadeOut;
      const next = Math.max(0, Math.min(clip.duration, start + (kind === 'fade-in' ? dFrames : -dFrames)));
      p.updateClip(clipId, (c) => (isMedia(c) ? { ...c, [key]: next } : c));
    } else {
      const edge = kind === 'trim-start' ? 'start' : 'end';
      let frame = (edge === 'start' ? clip.start : clipEnd(clip)) + dFrames;
      if (snap) {
        const r = snapValue(frame, candidates, thr);
        frame = r.value;
        line = r.target;
      }
      p.trimClip(clipId, edge, frame);
      // 트림이 한계에 걸리면 스냅선은 실제 가장자리와 다를 수 있으니 실제 값과 같을 때만 보여 준다
      const now = findClip(useProject.getState().edit, clipId)?.clip;
      if (now && line !== null && line !== (edge === 'start' ? now.start : clipEnd(now))) line = null;
    }
    useTimelineView.getState().set({ snapLine: line });
  };

  // 가장자리 자동 스크롤
  const tick = () => {
    raf = 0;
    const r = scroller.getBoundingClientRect();
    const left = r.left + HEADER_W; // 트랙 이름 칸 다음부터
    let v = 0;
    if (lastX > r.right - EDGE) v = Math.min(24, (lastX - (r.right - EDGE)) / 2 + 4);
    else if (lastX < left + EDGE) v = -Math.min(24, (left + EDGE - lastX) / 2 + 4);
    if (v !== 0 && started) {
      const before = scroller.scrollLeft;
      scroller.scrollLeft = Math.max(0, before + v);
      if (scroller.scrollLeft !== before) apply();
      raf = requestAnimationFrame(tick);
    }
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (!started) {
      if (Math.abs(ev.clientX - e.clientX) < MOVE_SLOP && Math.abs(ev.clientY - downY) < MOVE_SLOP) return;
      started = true;
    }
    apply();
    if (!raf) raf = requestAnimationFrame(tick);
  };
  let done = false;
  const cleanup = () => {
    done = true;
    cancelAnimationFrame(raf);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onCancel);
    target.removeEventListener('lostpointercapture', onUp);
    window.removeEventListener('keydown', onKey, true);
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    useTimelineView.getState().set({ snapLine: null });
  };
  const onUp = () => {
    if (done) return;
    cleanup();
    history.endGesture();
  };
  const onCancel = () => {
    if (done) return;
    cleanup();
    history.cancelGesture();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.code === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      onCancel();
    }
  };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onCancel);
  // 포인터 잡기가 풀리면(창 밖에서 놓기 등) 그 자리에서 확정한다 → 제스처가 영영 안 끝나는 일이 없다
  target.addEventListener('lostpointercapture', onUp);
  window.addEventListener('keydown', onKey, true);
}
