/** 메인 스레드 ↔ 파생 데이터 Worker 메시지 */
import type { AssetKind } from '../model/types';

export interface DeriveRequest {
  id: string;
  kind: AssetKind;
  blob: Blob;
  poster: boolean;
  filmstrip: boolean;
  peaks: boolean;
}

export type DeriveMessage =
  | { type: 'progress'; id: string; progress: number }
  | { type: 'poster'; id: string; blob: Blob }
  | { type: 'filmstrip'; id: string; blob: Blob; count: number; interval: number; thumbW: number; thumbH: number; cols: number }
  | { type: 'peaks'; id: string; peaks: Float32Array }
  | { type: 'done'; id: string }
  | { type: 'error'; id: string; message: string };

/** 필름스트립 썸네일 높이(px) — 타임라인 영상 트랙 높이 64px 안에 들어간다 */
export const THUMB_H = 56;
/** 파형: 초당 구간 수 */
export const PEAKS_PER_SEC = 100;
