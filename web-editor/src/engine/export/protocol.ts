/** 메인 스레드 ↔ 내보내기 Worker 메시지 */
import type { ProjectSnapshot } from '../../store/project';

export interface ExportAudio {
  sampleRate: number;
  numberOfChannels: number;
  /** 채널이 번갈아 들어간 값 [L,R,L,R,…] */
  interleaved: Float32Array;
}

export interface ExportFont {
  family: string;
  weight: number;
  /** 절대 주소. Worker에서는 상대 주소가 워커 파일 기준이 되어 깨진다 */
  url: string;
}

export interface ExportRequest {
  project: ProjectSnapshot;
  /** 자산 id → 원본 파일 */
  blobs: Record<string, Blob>;
  fonts: ExportFont[];
  totalFrames: number;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  audio: ExportAudio | null;
  /** File System Access로 파일에 바로 쓸 때 (전송됨) */
  writable?: WritableStream;
}

export type ExportMessage =
  | { type: 'progress'; frames: number; total: number; stage: ExportStage }
  | { type: 'done'; buffer: ArrayBuffer | null; bytes: number; ms: number }
  | { type: 'error'; message: string; code?: 'no-avc' }
  | { type: 'canceled' };

export type ExportStage = 'prepare' | 'video' | 'finalize';
