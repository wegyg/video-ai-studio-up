/**
 * 파생 데이터 Worker: 포스터, 필름스트립(스프라이트 한 장), 파형 피크를 만든다.
 * 메인 스레드를 막지 않도록 Worker에서 Mediabunny로 디코딩한다. 한 번에 한 파일씩 처리한다.
 * (Worker에는 Web Audio의 AudioBuffer가 없으므로 오디오는 AudioSampleSink로 읽는다)
 */
import { ALL_FORMATS, AudioSampleSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import { matchPreviewColor } from './color';
import { PEAKS_PER_SEC, THUMB_H, type DeriveMessage, type DeriveRequest } from './derive-protocol';

const port = self as unknown as {
  postMessage(m: DeriveMessage, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<DeriveRequest>) => void) | null;
};

const POSTER_MAX = 240;
const MAX_THUMBS = 120;
const SPRITE_COLS = 16;

function fit(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

async function toWebp(canvas: OffscreenCanvas, quality: number): Promise<Blob> {
  return canvas.convertToBlob({ type: 'image/webp', quality });
}

async function imagePoster(req: DeriveRequest) {
  const bmp = await createImageBitmap(req.blob);
  const { w, h } = fit(bmp.width, bmp.height, POSTER_MAX);
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  port.postMessage({ type: 'poster', id: req.id, blob: await toWebp(c, 0.85) });
}

async function deriveAv(req: DeriveRequest) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(req.blob) });
  try {
    const dur = await input.computeDuration();
    const progress = (p: number) => port.postMessage({ type: 'progress', id: req.id, progress: p });
    const vt = req.kind === 'video' ? await input.getPrimaryVideoTrack() : null;

    if (vt && (req.poster || req.filmstrip)) {
      await matchPreviewColor(vt); // 썸네일도 미리보기와 같은 색으로
      const dw = await vt.getDisplayWidth();
      const dh = await vt.getDisplayHeight();
      if (req.poster) {
        const { w, h } = fit(dw, dh, POSTER_MAX);
        const wc = await new CanvasSink(vt, { width: w, height: h, fit: 'fill' }).getCanvas(Math.min(1, dur * 0.25));
        if (wc) {
          const c = new OffscreenCanvas(w, h);
          c.getContext('2d')!.drawImage(wc.canvas, 0, 0);
          port.postMessage({ type: 'poster', id: req.id, blob: await toWebp(c, 0.85) });
        }
        progress(0.1);
      }
      if (req.filmstrip) {
        const interval = Math.max(1, dur / MAX_THUMBS);
        const count = Math.max(1, Math.ceil(dur / interval));
        const thumbH = THUMB_H;
        const thumbW = Math.min(200, Math.max(16, Math.round((thumbH * dw) / dh)));
        const cols = Math.min(count, SPRITE_COLS);
        const sprite = new OffscreenCanvas(cols * thumbW, Math.ceil(count / cols) * thumbH);
        const sctx = sprite.getContext('2d')!;
        // 각 구간 시작보다 살짝 뒤(0.05초)의 프레임 — 구간 경계에서 앞 프레임이 잡히지 않게
        const ts = Array.from({ length: count }, (_, i) => Math.min(Math.max(0, dur - 0.001), i * interval + 0.05));
        const sink = new CanvasSink(vt, { width: thumbW, height: thumbH, fit: 'fill', poolSize: 1 });
        let i = 0;
        for await (const wc of sink.canvasesAtTimestamps(ts)) {
          if (wc) sctx.drawImage(wc.canvas, (i % cols) * thumbW, Math.floor(i / cols) * thumbH);
          i++;
          if (i % 4 === 0) progress(0.1 + 0.6 * (i / count));
        }
        const blob = await toWebp(sprite, 0.7);
        port.postMessage({ type: 'filmstrip', id: req.id, blob, count, interval, thumbW, thumbH, cols });
      }
    }

    if (req.peaks) {
      const at = await input.getPrimaryAudioTrack();
      if (at && (await at.canDecode())) {
        const n = Math.max(1, Math.ceil(dur * PEAKS_PER_SEC));
        const peaks = new Float32Array(n);
        let buf = new Float32Array(0);
        let lastReport = 0;
        for await (const s of new AudioSampleSink(at).samples()) {
          const frames = s.numberOfFrames;
          const sr = s.sampleRate;
          const t0 = s.timestamp;
          if (buf.length < frames) buf = new Float32Array(frames);
          for (let c = 0; c < s.numberOfChannels; c++) {
            s.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
            let j = 0;
            while (j < frames) {
              const b = Math.floor((t0 + j / sr) * PEAKS_PER_SEC);
              const end = Math.min(frames, Math.ceil(((b + 1) / PEAKS_PER_SEC - t0) * sr));
              let m = 0;
              for (let k = j; k < end; k++) {
                const v = buf[k] < 0 ? -buf[k] : buf[k];
                if (v > m) m = v;
              }
              if (b >= 0 && b < n && m > peaks[b]) peaks[b] = m;
              j = Math.max(end, j + 1);
            }
          }
          s.close();
          if (t0 - lastReport > dur / 10) {
            lastReport = t0;
            progress(0.7 + 0.3 * Math.min(1, t0 / dur));
          }
        }
        port.postMessage({ type: 'peaks', id: req.id, peaks }, [peaks.buffer]);
      }
    }
  } finally {
    input.dispose();
  }
}

const queue: DeriveRequest[] = [];
let busy = false;

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const req = queue.shift()!;
    try {
      if (req.kind === 'image') {
        if (req.poster) await imagePoster(req);
      } else {
        await deriveAv(req);
      }
      port.postMessage({ type: 'done', id: req.id });
    } catch (e) {
      port.postMessage({ type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  busy = false;
}

port.onmessage = (e) => {
  queue.push(e.data);
  void pump();
};
