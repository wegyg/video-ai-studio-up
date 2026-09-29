/** 화면 상태 (실행 취소 기록 안 함): 선택, 플레이헤드, 재생, 줌, 스냅, 좌측 탭 */
import { create } from 'zustand';

export type LeftTab = 'media' | 'text' | 'audio' | 'effects' | 'elements';

/** 줌: 프레임당 픽셀. 0.2 = 초당 6px, 20 = 초당 600px */
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 20;
export const ZOOM_DEFAULT = 2;

export interface UIState {
  selectedClipId: string | null;
  /** 고른 트랜지션 = 그 트랜지션이 들어가는(뒤) 클립 id. 클립을 고르면 풀린다 */
  selectedTransition: string | null;
  /** 프레임 */
  playhead: number;
  playing: boolean;
  pxPerFrame: number;
  snap: boolean;
  /** 쇼츠 안전 영역 안내선 표시 (R7.9) */
  safeArea: boolean;
  leftTab: LeftTab;
  /**
   * 구간 미리 재생 (애니메이션을 고르면 그 부분만 한 번 보여 준다).
   * 재생이 end에 닿거나 멈추면 returnTo로 돌아간다.
   */
  playRange: { end: number; returnTo: number } | null;
  select: (id: string | null) => void;
  selectTransition: (toClipId: string | null) => void;
  setSafeArea: (on: boolean) => void;
  setPlayRange: (r: { end: number; returnTo: number } | null) => void;
  setPlayhead: (frame: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (pxPerFrame: number) => void;
  setSnap: (on: boolean) => void;
  setLeftTab: (tab: LeftTab) => void;
}

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export const useUI = create<UIState>()((set) => ({
  selectedClipId: null,
  selectedTransition: null,
  playhead: 0,
  playing: false,
  pxPerFrame: ZOOM_DEFAULT,
  snap: true,
  safeArea: false,
  leftTab: 'media',
  playRange: null,
  select: (id) => set({ selectedClipId: id, selectedTransition: null }),
  selectTransition: (toClipId) => set({ selectedTransition: toClipId, selectedClipId: null }),
  setSafeArea: (on) => set({ safeArea: on }),
  setPlayRange: (r) => set({ playRange: r }),
  setPlayhead: (frame) => set({ playhead: Math.max(0, Math.round(frame)) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (z) => set({ pxPerFrame: clampZoom(z) }),
  setSnap: (on) => set({ snap: on }),
  setLeftTab: (tab) => set({ leftTab: tab }),
}));
