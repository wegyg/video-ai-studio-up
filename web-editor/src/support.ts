/**
 * 브라우저 기능 확인. WebCodecs는 보안 컨텍스트(https, localhost)에서만 제공된다.
 * 인코딩 가능 여부는 Mediabunny의 canEncodeVideo/canEncodeAudio로 확인한다(공식 API).
 */
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';

export interface Support {
  secureContext: boolean;
  webcodecs: boolean;
  /** 1080x1920 30fps H.264 인코딩 가능 */
  avcEncode: boolean;
  /** 하드웨어 가속을 선호했을 때도 가능한지 (참고용) */
  avcEncodeHardware: boolean;
  /** 브라우저 자체 AAC 인코더. 없으면 @mediabunny/aac-encoder(WASM)를 쓴다. */
  aacEncodeNative: boolean;
  fileSystemAccess: boolean;
}

/** 편집기를 아예 쓸 수 없는 환경인지 (R1.3 안내 화면) */
export function isBlocked(s: Pick<Support, 'secureContext' | 'webcodecs'>): boolean {
  return !s.secureContext || !s.webcodecs;
}

let cached: Promise<Support> | null = null;

export function detectSupport(): Promise<Support> {
  if (cached) return cached;
  cached = (async () => {
    const secureContext = window.isSecureContext;
    const webcodecs =
      typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
    const base = { width: 1080, height: 1920, frameRate: 30, bitrate: 10_000_000 };
    const safe = async (f: () => Promise<boolean>) => {
      try {
        return await f();
      } catch {
        return false;
      }
    };
    const avcEncode = webcodecs && (await safe(() => canEncodeVideo('avc', base)));
    const avcEncodeHardware =
      webcodecs && (await safe(() => canEncodeVideo('avc', { ...base, hardwareAcceleration: 'prefer-hardware' })));
    const aacEncodeNative =
      webcodecs && (await safe(() => canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192_000 })));
    const fileSystemAccess = typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
    return { secureContext, webcodecs, avcEncode, avcEncodeHardware, aacEncodeNative, fileSystemAccess };
  })();
  return cached;
}
