/**
 * 테스트(Playwright)가 페이지 안의 상태를 읽을 때 쓰는 window.__editor 타입.
 * 이 파일은 다른 모듈을 import하지 않는다 (테스트 tsconfig에서도 쓰기 위해).
 */
export interface SpikeResult {
  support: Record<string, boolean>;
  decode: { codec: string | null; canDecode: boolean; duration: number; width: number; height: number; pixelAt2_5s: number[] };
  encode: {
    aacPath: 'native' | 'wasm';
    frames: number;
    encodeMs: number;
    fps: number;
    bytes: number;
    out: { videoCodec: string | null; audioCodec: string | null; width: number; height: number; duration: number };
  };
  fonts: Record<string, boolean>;
}

/** 테스트에서 읽는 상태 (직렬화된 데이터) */
export interface DebugState {
  id: string;
  name: string;
  assets: Record<string, { id: string; kind: string; name: string; durationFrames?: number; width?: number; height?: number; hasAudio: boolean }>;
  edit: {
    ratio: string;
    tracks: {
      id: string;
      kind: string;
      name: string;
      muted: boolean;
      clips: {
        id: string;
        type: string;
        start: number;
        duration: number;
        inPoint?: number;
        assetId?: string;
        volume?: number;
        fadeIn?: number;
        fadeOut?: number;
        speed?: number;
        transform?: { x: number; y: number; scale: number; rotation: number; opacity: number };
        // 텍스트 클립
        text?: string;
        font?: string;
        size?: number;
        weight?: number;
        color?: string;
        align?: string;
        lineHeight?: number;
        stroke?: { color: string; width: number };
        box?: { enabled: boolean; color: string; opacity: number; padding: number; radius: number };
        shadow?: { enabled: boolean; color: string; blur: number; offsetX: number; offsetY: number };
        animIn?: { type: string; duration: number };
        animOut?: { type: string; duration: number };
      }[];
    }[];
  };
  ui: { selectedClipId: string | null; playhead: number; playing: boolean; pxPerFrame: number; snap: boolean; leftTab: string };
  history: { past: number; future: number };
}

export interface DebugMedia {
  status: string;
  progress: number;
  hasUrl: boolean;
  hasPoster: boolean;
  filmstrip: { count: number; interval: number; thumbW: number; thumbH: number; cols: number } | null;
  peaksLength: number;
  peaksMax: number;
}

export interface EditorDebugApi {
  version: string;
  support: () => Promise<Record<string, boolean>>;
  spike: (video: Blob) => Promise<SpikeResult>;
  state: () => DebugState;
  media: (assetId: string) => DebugMedia | null;
  /** 필름스트립 index번째 썸네일 가운데 픽셀 [r,g,b] */
  filmstripPixel: (assetId: string, index: number) => number[] | null;
  /** IndexedDB에 저장된 원본/파생 데이터 */
  stored: () => Promise<{ media: { id: string; size: number; name: string }[]; derivedKeys: string[] }>;
  /** 미리보기 엔진 상태 */
  preview: () => {
    playing: boolean;
    starting: boolean;
    renderedFrame: number;
    ready: boolean;
    slots: number;
    audioState: string;
    level: number;
    maxDrift: number;
    drawFps: number;
    maxGapMs: number;
  } | null;
  /** 미리보기 캔버스의 (x, y) 비율 위치 픽셀 [r,g,b] (0~1, 기본 가운데) */
  previewPixel: (fx?: number, fy?: number) => number[];
  /** 선택한(또는 지정한) 클립이 미리보기에서 놓인 사각형 — 프로젝트 좌표 */
  clipBox: (clipId?: string) => { cx: number; cy: number; w: number; h: number; rotation: number } | null;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __editor: EditorDebugApi;
  }
}
