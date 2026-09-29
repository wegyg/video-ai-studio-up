/**
 * 미디어 런타임 상태 (저장하지 않음): 원본 Blob, object URL, 포스터, 필름스트립, 파형.
 * 프로젝트에 저장되는 메타데이터(AssetMeta)는 store/project.ts의 assets에 있다.
 */
import { create } from 'zustand';

export interface Filmstrip {
  bitmap: ImageBitmap;
  count: number;
  interval: number;
  thumbW: number;
  thumbH: number;
  cols: number;
}

export interface MediaEntry {
  status: 'loading' | 'ready' | 'error';
  /** 0~1, 파생 데이터 생성 진행률 */
  progress: number;
  /** 원본 재생용 object URL */
  url?: string;
  posterUrl?: string;
  filmstrip?: Filmstrip;
  /** 초당 100개 최대 진폭 (0~1) */
  peaks?: Float32Array;
  error?: string;
}

interface MediaState {
  entries: Record<string, MediaEntry>;
  patch: (id: string, patch: Partial<MediaEntry>) => void;
}

export const useMedia = create<MediaState>()((set) => ({
  entries: {},
  patch: (id, patch) =>
    set((s) => {
      const prev: MediaEntry = (s.entries as Partial<Record<string, MediaEntry>>)[id] ?? { status: 'loading', progress: 0 };
      return { entries: { ...s.entries, [id]: { ...prev, ...patch } } };
    }),
}));

/** 원본 Blob (반응형일 필요 없음) */
export const sourceBlobs = new Map<string, Blob>();

export const mediaEntry = (id: string): MediaEntry | undefined => useMedia.getState().entries[id];
