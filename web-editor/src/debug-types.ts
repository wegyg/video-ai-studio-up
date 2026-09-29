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
        // 필터 (2단계)
        filter?: {
          preset: string | null;
          adjust: { brightness: number; contrast: number; saturation: number; temperature: number; sharpness: number; vignette: number };
        };
      }[];
    }[];
    background?: { kind: 'color'; color: string } | { kind: 'blur'; amount: number };
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
  /** 미리보기가 이 클립에 적용 중인 소리 크기 (GainNode 값) */
  clipGain: (clipId: string) => number | null;
  /** 미리보기 캔버스 해상도를 강제로 바꾼다 (진단용: 해상도 차이인지 내용 차이인지 가르기) */
  setPreviewResolution: (w: number, h: number) => void;
  /** 지금 상태를 바로 저장한다 (자동 저장을 기다리지 않고) */
  saveNow: () => Promise<void>;
  /** 저장이 몇 번 일어났는지 */
  savedTimes: () => number;
  /** 안 쓰는 저장 데이터 정리를 지금 돌린다. daysLater로 "며칠 뒤"를 흉내 낸다 */
  cleanupStorage: (daysLater?: number) => Promise<{ media: number; derived: number; kept: number }>;
  /** 프로젝트 파일(JSON)로 나갈 내용 */
  projectFile: () => unknown;
  /** 미디어를 목록에서 지운다 (그 미디어를 쓰는 클립도 지워진다) */
  removeAsset: (id: string) => void;
  /** 미리보기 캔버스에서 여러 좌표(0~1 비율)의 픽셀을 한 번에 읽는다 */
  previewPixels: (points: [number, number][]) => number[][];
  /**
   * 같은 원본 프레임을 미리보기(<video>)와 내보내기(Mediabunny, 같은 색 설정) 길로 풀어 비교한다.
   * raw면 두 길의 RGB 원시값(W×H×3, base64)도 돌려준다.
   */
  decodePaths: (
    blob: Blob,
    frame: number,
    raw?: boolean,
  ) => Promise<{
    w: number;
    h: number;
    colorSpace: VideoColorSpaceInit;
    applied: VideoColorSpaceInit | null;
    meanAbs: number;
    video?: string;
    sink?: string;
  }>;
  /** 마지막으로 내보낸 MP4의 바이트 수 */
  lastExportBytes: () => number;
  /** 브라우저 전용 저장소(OPFS)에 쓴 MP4를 검사한다 — 파일에 바로 쓰는 저장 경로 확인용 */
  inspectOpfsFile: (name: string) => Promise<{
    bytes: number;
    boxes: string[];
    info: { videoCodec: string | null; audioCodec: string | null; width: number; height: number; frameCount: number; videoDuration: number };
  }>;
  /** 마지막으로 내보낸 MP4를 다시 읽어 정보와 픽셀을 꺼낸다 (G3 검증) */
  verifyLastExport: (
    times: number[],
    points: [number, number][],
  ) => Promise<{
    info: {
      videoCodec: string | null;
      audioCodec: string | null;
      width: number;
      height: number;
      duration: number;
      videoDuration: number;
      frameCount: number;
      frameRate: number;
    };
    frames: { time: number; pixels: number[][] }[];
  }>;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __editor: EditorDebugApi;
  }
}
