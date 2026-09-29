/** 화면 상태 (실행 취소 기록 안 함): 선택, 플레이헤드, 재생, 줌, 스냅, 좌측 탭 */
import { create } from 'zustand';

export type LeftTab = 'media' | 'text' | 'audio' | 'effects';

/** 줌: 프레임당 픽셀. 0.2 = 초당 6px, 20 = 초당 600px */
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 20;
export const ZOOM_DEFAULT = 2;

export interface UIState {
  selectedClipId: string | null;
  /** 프레임 */
  playhead: number;
  playing: boolean;
  pxPerFrame: number;
  snap: boolean;
  /** 쇼츠 안전 영역 안내선 표시 (R7.9) */
  safeArea: boolean;
  leftTab: LeftTab;
  select: (id: string | null) => void;
  setSafeArea: (on: boolean) => void;
  setPlayhead: (frame: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (pxPerFrame: number) => void;
  setSnap: (on: boolean) => void;
  setLeftTab: (tab: LeftTab) => void;
}

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export const useUI = create<UIState>()((set) => ({
  selectedClipId: null,
  playhead: 0,
  playing: false,
  pxPerFrame: ZOOM_DEFAULT,
  snap: true,
  safeArea: false,
  leftTab: 'media',
  select: (id) => set({ selectedClipId: id }),
  setSafeArea: (on) => set({ safeArea: on }),
  setPlayhead: (frame) => set({ playhead: Math.max(0, Math.round(frame)) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (z) => set({ pxPerFrame: clampZoom(z) }),
  setSnap: (on) => set({ snap: on }),
  setLeftTab: (tab) => set({ leftTab: tab }),
}));
