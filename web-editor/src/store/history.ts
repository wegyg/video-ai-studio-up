/**
 * 실행 취소/다시 실행과 "제스처" 묶음 (R9.3: 드래그 한 번 = 기록 1개).
 *
 * zundo는 기록 중에 setState가 불리면 바로 전 상태를 pastStates에 넣는다.
 * 그래서 제스처는 이렇게 처리한다:
 *   begin: 시작 상태(before)를 저장하고 기록을 멈춘다(pause)
 *   (드래그 중: 상태를 자유롭게 갱신 → 미리보기에 바로 반영)
 *   end:   before로 되돌린 뒤 기록을 켜고(resume) 최종 상태를 한 번 set → before가 기록 1개로 남는다
 */
import { useStore } from 'zustand';
import { normalizeTransitions } from '../model/transitions';
import type { EditState } from '../model/types';
import { useProject } from './project';

let gestureBefore: EditState | null = null;

export const history = {
  undo(steps = 1): void {
    if (gestureBefore) return;
    useProject.temporal.getState().undo(steps);
  },
  redo(steps = 1): void {
    if (gestureBefore) return;
    useProject.temporal.getState().redo(steps);
  },
  inGesture(): boolean {
    return gestureBefore !== null;
  },
  beginGesture(): void {
    // 이전 제스처가 끝나지 않았으면(이벤트 유실 등) 먼저 확정한다 — 기록이 멈춘 채로 남지 않게
    if (gestureBefore) history.endGesture();
    gestureBefore = useProject.getState().edit;
    useProject.temporal.getState().pause();
  },
  endGesture(): void {
    const before = gestureBefore;
    gestureBefore = null;
    const t = useProject.temporal.getState();
    if (!before) return;
    // 드래그 중에 미뤄 둔 트랜지션 정리를 여기서 한다 (store/project.ts의 apply 참고)
    let after = normalizeTransitions(useProject.getState().edit);
    // 끌다가 제자리로 돌아온 경우처럼 내용이 같으면 기록하지 않는다 (실행 취소에 빈 단계가 생기지 않게)
    if (after !== before && JSON.stringify(after) === JSON.stringify(before)) after = before;
    if (useProject.getState().edit !== before) useProject.setState({ edit: before }); // 기록 멈춤 상태라 남지 않음
    t.resume();
    if (after !== before) useProject.setState({ edit: after }); // before가 기록 1개로 남음
  },
  /** 제스처 취소 (Esc 등): 시작 상태로 되돌리고 기록하지 않는다 */
  cancelGesture(): void {
    const before = gestureBefore;
    gestureBefore = null;
    if (before) useProject.setState({ edit: before });
    useProject.temporal.getState().resume();
  },
};

export const useCanUndo = (): boolean => useStore(useProject.temporal, (s) => s.pastStates.length > 0);
export const useCanRedo = (): boolean => useStore(useProject.temporal, (s) => s.futureStates.length > 0);
