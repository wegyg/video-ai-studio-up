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

export interface EditorDebugApi {
  version: string;
  support: () => Promise<Record<string, boolean>>;
  spike: (video: Blob) => Promise<SpikeResult>;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __editor: EditorDebugApi;
  }
}
