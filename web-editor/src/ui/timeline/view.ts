/** 타임라인 화면 상태: 스크롤 위치, 보이는 너비, 스냅선, 미디어 끌기 중인 자산 */
import { create } from 'zustand';
import type { TransitionKind } from '../../model/types';

interface TimelineView {
  /** 스크롤 영역의 scrollLeft (= 보이는 구간의 트랙 좌표 시작) */
  scrollLeft: number;
  /** 트랙이 보이는 너비 (이름 칸 제외) */
  viewW: number;
  /** 스냅된 기준점(프레임). 드래그 중에만 */
  snapLine: number | null;
  /** 효과 탭에서 끌고 있는 트랜지션 종류 (끄는 동안 경계마다 놓을 곳을 보여 준다) */
  transitionDrag: TransitionKind | null;
  set: (p: Partial<Omit<TimelineView, 'set'>>) => void;
}

export const useTimelineView = create<TimelineView>()((set) => ({
  scrollLeft: 0,
  viewW: 0,
  snapLine: null,
  transitionDrag: null,
  set: (p) => set(p),
}));

/**
 * 미디어 패널에서 끌고 있는 자산 id. dragover 중에는 dataTransfer 내용을 읽을 수 없어서
 * (브라우저 보안 규칙) 트랙 종류가 맞는지 확인하려고 따로 기억해 둔다.
 */
export const assetDrag = { id: null as string | null };

/** 트랜지션을 끌 때 dataTransfer에 넣는 형식 */
export const TRANSITION_DRAG_TYPE = 'application/x-editor-transition';
