/**
 * 내보내기 제어 (메인 스레드): 준비 → Worker에 맡기기 → 진행률/남은 시간 → 저장.
 * 저장은 File System Access로 파일에 바로 쓰고, 안 되면 다운로드로 내려받는다 (R11.7).
 */
import { fontUrl } from '../../fonts';
import { sourceBlobs } from '../../media/store';
import { editDuration } from '../../model/time';
import { FPS, RATIO_SIZE, type EditState, type TextFont, type TextWeight } from '../../model/types';
import { useProject } from '../../store/project';
import { mixExportAudio } from './audio-mix';
import type { ExportFont, ExportMessage, ExportRequest, ExportStage } from './protocol';

/** 1080×1920 30fps 기준 화질 (넉넉하게) */
export const VIDEO_BITRATE = 10_000_000;
export const AUDIO_BITRATE = 192_000;

export interface ExportProgress {
  stage: ExportStage;
  frames: number;
  total: number;
  /** 0~1 */
  ratio: number;
  elapsedMs: number;
  /** 남은 예상 시간(ms). 아직 모르면 null */
  etaMs: number | null;
}

export interface ExportResult {
  bytes: number;
  /** 인코딩에 걸린 시간 */
  ms: number;
  fileName: string;
  /** 다운로드로 저장했는지 */
  downloaded: boolean;
  seconds: number;
}

export interface ExportHandlers {
  onProgress?: (p: ExportProgress) => void;
  onDone?: (r: ExportResult) => void;
  onError?: (message: string, code?: string) => void;
  onCanceled?: () => void;
}

const fontsUsed = (edit: EditState): ExportFont[] => {
  const set = new Set<string>();
  for (const t of edit.tracks) {
    for (const c of t.clips) {
      if (c.type === 'text') set.add(`${c.font}|${c.weight}`);
    }
  }
  return [...set].map((key) => {
    const [family, weight] = key.split('|');
    return { family, weight: Number(weight), url: '' };
  });
};

function fileNameFor(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'video';
  return `${cleaned}.mp4`;
}

/**
 * 마지막으로 내보낸 파일의 바이트 (다운로드로 저장한 경우).
 * 테스트가 "내려받은 파일과 같은 바이트"로 미리보기와 비교하는 데 쓴다 (G3).
 */
let lastExport: ArrayBuffer | null = null;
export const lastExportBuffer = (): ArrayBuffer | null => lastExport;

export class ExportJob {
  private worker: Worker | null = null;
  private startedAt = 0;
  private samples: { t: number; frames: number }[] = [];
  private canceledByUser = false;

  constructor(private handlers: ExportHandlers) {}

  get running(): boolean {
    return this.worker !== null;
  }

  async start(): Promise<void> {
    const p = useProject.getState();
    const edit = p.edit;
    const totalFrames = editDuration(edit);
    if (totalFrames <= 0) {
      this.handlers.onError?.('empty');
      return;
    }
    const { width, height } = RATIO_SIZE[edit.ratio];
    this.startedAt = performance.now();
    this.samples = [];
    this.canceledByUser = false;
    this.handlers.onProgress?.({ stage: 'prepare', frames: 0, total: totalFrames, ratio: 0, elapsedMs: 0, etaMs: null });

    // 쓰는 원본만 모은다
    const blobs: Record<string, Blob> = {};
    for (const t of edit.tracks) {
      for (const c of t.clips) {
        if (c.type === 'text') continue;
        const blob = sourceBlobs.get(c.assetId);
        if (blob) blobs[c.assetId] = blob;
      }
    }

    // 글꼴은 절대 주소로 넘긴다 (Worker에서 상대 주소는 워커 파일 기준이라 깨진다)
    const fonts = fontsUsed(edit).map((f) => ({
      ...f,
      url: new URL(fontUrl(f.family as TextFont, f.weight as TextWeight), location.href).href,
    }));

    let audio = null;
    try {
      audio = await mixExportAudio(edit, p.assets, blobs, totalFrames);
    } catch (e) {
      console.warn('[export] 소리 합치기 실패, 소리 없이 내보냅니다', e);
    }

    // 저장 위치: 고를 수 있으면 파일에 바로 쓴다
    const fileName = fileNameFor(p.name);
    let writable: WritableStream | undefined;
    const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker({
          suggestedName: fileName,
          types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }],
        });
        writable = await handle.createWritable();
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') {
          this.handlers.onCanceled?.();
          return;
        }
        writable = undefined; // 권한이 없으면 다운로드로
      }
    }

    const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<ExportMessage>) => this.onMessage(e.data, { fileName, downloaded: !writable, seconds: totalFrames / FPS });
    worker.onerror = (e) => {
      this.finish();
      this.handlers.onError?.(e.message || 'worker');
    };

    const req: ExportRequest = {
      project: { id: p.id, name: p.name, assets: p.assets, edit },
      blobs,
      fonts,
      totalFrames,
      width,
      height,
      fps: FPS,
      videoBitrate: VIDEO_BITRATE,
      audioBitrate: AUDIO_BITRATE,
      audio,
      writable,
    };
    const transfer: Transferable[] = [];
    if (writable) transfer.push(writable);
    if (audio) transfer.push(audio.interleaved.buffer);
    worker.postMessage(req, transfer);
  }

  private onMessage(m: ExportMessage, info: { fileName: string; downloaded: boolean; seconds: number }): void {
    if (m.type === 'progress') {
      const now = performance.now();
      this.samples.push({ t: now, frames: m.frames });
      if (this.samples.length > 40) this.samples.shift();
      const first = this.samples[0];
      const rate = m.frames > first.frames && now > first.t ? (m.frames - first.frames) / (now - first.t) : 0;
      const etaMs = rate > 0 ? Math.max(0, (m.total - m.frames) / rate) : null;
      this.handlers.onProgress?.({
        stage: m.stage,
        frames: m.frames,
        total: m.total,
        ratio: m.total ? m.frames / m.total : 0,
        elapsedMs: now - this.startedAt,
        etaMs,
      });
    } else if (m.type === 'done') {
      this.finish();
      if (m.buffer) {
        lastExport = m.buffer; // 테스트가 같은 바이트로 결과를 검증할 수 있게 들고 있는다
        const blob = new Blob([m.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = info.fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      this.handlers.onDone?.({ bytes: m.bytes, ms: m.ms, fileName: info.fileName, downloaded: info.downloaded, seconds: info.seconds });
    } else if (m.type === 'canceled') {
      this.finish();
      this.handlers.onCanceled?.();
    } else if (m.type === 'error') {
      this.finish();
      if (this.canceledByUser) this.handlers.onCanceled?.();
      else this.handlers.onError?.(m.message, m.code);
    }
  }

  cancel(): void {
    this.canceledByUser = true;
    this.worker?.postMessage({ type: 'cancel' });
  }

  private finish(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
