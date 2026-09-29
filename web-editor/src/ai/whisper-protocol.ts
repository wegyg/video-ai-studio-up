/** 메인 스레드 ↔ Whisper Worker 메시지 (R20) */
import type { AsrWord } from '../model/captions';

export type WhisperDevice = 'webgpu' | 'wasm';

export type WhisperModelId = 'fast' | 'normal' | 'accurate';

export interface WhisperModel {
  id: WhisperModelId;
  /** Hugging Face 저장소. 단어별 타이밍에는 `_timestamped` 모델이 필요하다 */
  repo: string;
  /** 처음 한 번 받는 모델 크기(MB) — 장치별로 다른 파일을 쓴다 */
  mb: Record<WhisperDevice, number>;
}

/** 크기는 2026-09-29에 Hugging Face API로 잰 ONNX 파일 합계 */
export const WHISPER_MODELS: WhisperModel[] = [
  { id: 'fast', repo: 'onnx-community/whisper-tiny_timestamped', mb: { webgpu: 46, wasm: 101 } },
  { id: 'normal', repo: 'onnx-community/whisper-base_timestamped', mb: { webgpu: 69, wasm: 180 } },
  { id: 'accurate', repo: 'onnx-community/whisper-small_timestamped', mb: { webgpu: 146, wasm: 547 } },
];

export const DEFAULT_WHISPER_MODEL: WhisperModelId = 'normal';
export const whisperModel = (id: WhisperModelId): WhisperModel => WHISPER_MODELS.find((m) => m.id === id) ?? WHISPER_MODELS[1];

export interface TranscribeRequest {
  repo: string;
  /** 16kHz 모노 */
  audio: Float32Array;
  /** Whisper 언어 이름 (한국어 = 'korean') */
  language: string;
}

export type WhisperMessage =
  | { type: 'device'; device: WhisperDevice }
  /** 모델 파일 내려받기 (처음 한 번). 받은 뒤에는 브라우저 캐시에서 읽어 이 메시지가 거의 없다 */
  | { type: 'download'; loaded: number; total: number }
  | { type: 'stage'; stage: 'model' | 'transcribe' }
  | { type: 'result'; words: AsrWord[]; text: string; ms: number }
  | { type: 'error'; message: string };
