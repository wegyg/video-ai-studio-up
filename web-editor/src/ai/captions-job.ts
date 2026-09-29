/**
 * 자동 자막 한 번 실행 (R20): 소리 모으기 → Whisper 인식(Worker) → 자막 텍스트 클립 만들기.
 * 소리는 내보내기와 같은 믹서로 모으되 16kHz 모노로 받는다 (Whisper 입력 형식).
 */
import { actions } from '../actions';
import { ko } from '../i18n/ko';
import { sourceBlobs } from '../media/store';
import { buildCaptions, type CaptionStyle } from '../model/captions';
import { isMedia } from '../model/ops';
import { editDuration } from '../model/time';
import { FPS, type TextStyle } from '../model/types';
import { mixExportAudio } from '../engine/export/audio-mix';
import { useProject } from '../store/project';
import { whisperModel, type TranscribeRequest, type WhisperDevice, type WhisperMessage, type WhisperModelId } from './whisper-protocol';

/** Whisper가 받는 표본율 */
export const ASR_SAMPLE_RATE = 16000;

export type CaptionStage = 'audio' | 'model' | 'transcribe' | 'clips';

export interface CaptionProgress {
  stage: CaptionStage;
  device?: WhisperDevice;
  /** 모델 내려받기 (처음 한 번) */
  loaded?: number;
  total?: number;
  elapsedMs: number;
}

export interface CaptionResult {
  /** 만든 자막 클립 수 */
  clips: number;
  words: number;
  text: string;
  /** 인식에 걸린 시간 */
  ms: number;
  device: WhisperDevice;
}

export interface CaptionOptions {
  /** 이 클립의 소리만 인식한다 (null이면 타임라인 전체 소리) */
  clipId: string | null;
  model: WhisperModelId;
  style: CaptionStyle;
  /** 자막 글자 모양 (텍스트 프리셋) */
  textStyle?: TextStyle;
}

export class CaptionJob {
  private worker: Worker | null = null;
  private canceled = false;
  private startedAt = 0;

  constructor(
    private handlers: {
      onProgress?: (p: CaptionProgress) => void;
      onDone?: (r: CaptionResult) => void;
      onError?: (message: string) => void;
    },
  ) {}

  cancel(): void {
    this.canceled = true;
    this.worker?.terminate();
    this.worker = null;
  }

  private emit(p: Omit<CaptionProgress, 'elapsedMs'>): void {
    this.handlers.onProgress?.({ ...p, elapsedMs: performance.now() - this.startedAt });
  }

  async run(opts: CaptionOptions): Promise<void> {
    this.startedAt = performance.now();
    try {
      this.emit({ stage: 'audio' });
      const p = useProject.getState();
      const totalFrames = editDuration(p.edit);
      if (totalFrames <= 0) return this.fail(ko.captions.noAudio);
      const blobs: Record<string, Blob> = {};
      for (const t of p.edit.tracks) {
        for (const c of t.clips) {
          if (!isMedia(c) || (opts.clipId && c.id !== opts.clipId)) continue;
          const blob = sourceBlobs.get(c.assetId);
          if (blob) blobs[c.assetId] = blob;
        }
      }
      const audio = await mixExportAudio(p.edit, p.assets, blobs, totalFrames, {
        sampleRate: ASR_SAMPLE_RATE,
        channels: 1,
        only: opts.clipId ? new Set([opts.clipId]) : undefined,
        ducking: false, // 인식에는 줄이지 않은 원래 소리를 쓴다
      });
      if (this.canceled) return;
      if (!audio) return this.fail(ko.captions.noAudio);

      const words = await this.transcribe(whisperModel(opts.model).repo, audio.interleaved);
      if (this.canceled || !words) return;

      this.emit({ stage: 'clips', device: words.device });
      const specs = buildCaptions(words.words, { style: opts.style, fps: FPS });
      const clips = actions.createCaptions(specs, opts.style, opts.textStyle);
      this.handlers.onDone?.({ clips, words: words.words.length, text: words.text, ms: words.ms, device: words.device });
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    } finally {
      this.worker?.terminate();
      this.worker = null;
    }
  }

  private fail(message: string): void {
    if (!this.canceled) this.handlers.onError?.(message);
  }

  /** Worker에서 인식. 취소되면 null */
  private transcribe(repo: string, audio: Float32Array): Promise<{ words: import('../model/captions').AsrWord[]; text: string; ms: number; device: WhisperDevice } | null> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      let device: WhisperDevice = 'wasm';
      worker.onmessage = (e: MessageEvent<WhisperMessage>) => {
        const m = e.data;
        if (m.type === 'device') {
          device = m.device;
          this.emit({ stage: 'model', device });
        } else if (m.type === 'download') {
          this.emit({ stage: 'model', device, loaded: m.loaded, total: m.total });
        } else if (m.type === 'stage') {
          this.emit({ stage: m.stage, device });
        } else if (m.type === 'result') {
          resolve({ words: m.words, text: m.text, ms: m.ms, device });
        } else {
          reject(new Error(m.message));
        }
      };
      worker.onerror = (ev) => reject(new Error(ev.message || 'worker'));
      const req: TranscribeRequest = { repo, audio, language: 'korean' };
      worker.postMessage(req, [audio.buffer]);
      if (this.canceled) {
        worker.terminate();
        resolve(null);
      }
    });
  }
}
