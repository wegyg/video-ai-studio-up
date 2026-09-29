/**
 * MP4 내보내기 Worker (R11).
 *
 * 영상: 원본을 Mediabunny로 **순서대로** 디코딩(탐색 없이 빨리) → 미리보기와 같은 `drawFrame`으로
 *       OffscreenCanvas에 합성 → CanvasSource(H.264)로 인코딩.
 * 소리: 메인 스레드에서 이미 합쳐 보낸 값을 AudioSample로 조금씩 넣는다(Worker에는 Web Audio가 없다).
 * 영상과 소리를 번갈아 넣어(1초 단위) 메모리에 쌓이는 양을 줄인다(Mediabunny 권고).
 */
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  canEncodeAudio,
  canEncodeVideo,
  type InputVideoTrack,
  type WrappedCanvas,
} from 'mediabunny';
import { baseSize, clipAt, drawFrame, type FrameSources, type VisualSource } from '../compose';
import { createEffects } from '../gl/effects';
import { matchPreviewColor } from '../../media/color';
import { needsEffects } from '../../model/filters';
import { drawTextClip } from '../text';
import type { Clip, EditState, MediaClip } from '../../model/types';
import type { ExportMessage, ExportRequest } from './protocol';

const port = self as unknown as {
  postMessage(m: ExportMessage, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ExportRequest | { type: 'cancel' }>) => void) | null;
  fonts?: FontFaceSet;
};

let canceled = false;

/** 한 클립의 원본 프레임을 순서대로 읽는다 (타임라인 진행과 같은 방향이라 탐색이 없다) */
class ClipReader {
  private gen: AsyncGenerator<WrappedCanvas, void, unknown>;
  private current: WrappedCanvas | null = null;
  private ended = false;

  constructor(sink: CanvasSink, startSec: number, endSec: number) {
    this.gen = sink.canvases(startSec, endSec);
  }

  /** 원본 시간 t(초)에 보여야 할 프레임 */
  async at(t: number): Promise<WrappedCanvas | null> {
    while (!this.ended && (!this.current || this.current.timestamp + this.current.duration <= t)) {
      const r = await this.gen.next();
      if (r.done) {
        this.ended = true;
        break;
      }
      this.current = r.value;
    }
    return this.current;
  }

  async close(): Promise<void> {
    try {
      await this.gen.return();
    } catch {
      /* 이미 끝난 반복자 */
    }
  }
}

async function loadFonts(req: ExportRequest): Promise<void> {
  const set = port.fonts;
  if (!set) return; // 글꼴을 못 넣는 환경이면 기본 글꼴로 그린다
  await Promise.all(
    req.fonts.map(async (f) => {
      try {
        const face = new FontFace(f.family, `url(${f.url})`, { weight: String(f.weight) });
        set.add(face);
        await face.load();
      } catch (e) {
        console.warn('[export] 글꼴 불러오기 실패', f, e);
      }
    }),
  );
}

async function run(req: ExportRequest): Promise<void> {
  const t0 = performance.now();
  const { width: W, height: H, fps, totalFrames } = req;
  port.postMessage({ type: 'progress', frames: 0, total: totalFrames, stage: 'prepare' });

  if (!(await canEncodeVideo('avc', { width: W, height: H, frameRate: fps, bitrate: req.videoBitrate }))) {
    port.postMessage({ type: 'error', message: 'avc', code: 'no-avc' });
    return;
  }
  const nativeAac = req.audio ? await canEncodeAudio('aac', { numberOfChannels: req.audio.numberOfChannels, sampleRate: req.audio.sampleRate }) : true;
  if (req.audio && !nativeAac) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  }
  await loadFonts(req);

  // 원본별 입력 준비 (영상은 트랙과 표시 크기, 이미지는 ImageBitmap)
  const inputs: Input[] = [];
  const videos = new Map<string, { track: InputVideoTrack; width: number; height: number }>();
  const images = new Map<string, ImageBitmap>();
  const edit: EditState = req.project.edit;

  const usedAssets = new Set<string>();
  for (const t of edit.tracks) for (const c of t.clips) if (c.type === 'video' || c.type === 'image') usedAssets.add(c.assetId);

  for (const assetId of usedAssets) {
    const blob = req.blobs[assetId];
    const meta = req.project.assets[assetId];
    if (!blob || !meta) continue;
    if (meta.kind === 'image') {
      images.set(assetId, await createImageBitmap(blob));
    } else {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
      inputs.push(input);
      const track = await input.getPrimaryVideoTrack();
      if (track) {
        // 색 정보 없는 영상도 미리보기(<video>)와 같은 색으로 풀리게 (media/color.ts)
        await matchPreviewColor(track);
        videos.set(assetId, { track, width: await track.getDisplayWidth(), height: await track.getDisplayHeight() });
      }
    }
  }

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const seconds = totalFrames / fps;
  // 'reserve'는 파일 앞에 목차(moov) 자리를 비워 두고 쓰는 방식이라, 파일에 바로 써도 Fast Start MP4가 된다.
  // 휴대폰·SNS 업로드에서 앞부분만 받아도 바로 재생된다. 대신 패킷 수 상한을 알려 줘야 한다(33% 여유).
  const target = req.writable ? new StreamTarget(req.writable) : new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: req.writable ? 'reserve' : 'in-memory' }), target });
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: req.videoBitrate,
    hardwareAcceleration: 'no-preference',
  });
  output.addVideoTrack(videoSource, { frameRate: fps, maximumPacketCount: Math.ceil(totalFrames * 1.34) + 10 });

  const audio = req.audio;
  const audioSource = audio ? new AudioSampleSource({ codec: 'aac', bitrate: req.audioBitrate }) : null;
  if (audioSource) output.addAudioTrack(audioSource, { maximumPacketCount: Math.ceil(seconds * 100 * 1.34) + 10 });

  const readers = new Map<string, ClipReader>();
  const cleanup = async () => {
    await Promise.all([...readers.values()].map((r) => r.close()));
    readers.clear();
    for (const b of images.values()) b.close();
    images.clear();
    for (const i of inputs) i.dispose();
  };

  try {
    await output.start();

    /**
     * 이 클립의 원본 프레임을 준비한다. 클립마다 따로 디코더를 둔다(같은 원본을 두 트랙에서 동시에 써도 섞이지 않게).
     * 디코딩 크기는 실제로 화면에 그려질 크기로 줄인다 — 4K 원본을 4K로 풀었다가 다시 줄이는 낭비를 없앤다.
     */
    const readerFor = (clip: MediaClip): ClipReader | null => {
      let r = readers.get(clip.id);
      if (!r) {
        const v = videos.get(clip.assetId);
        if (!v) return null;
        const drawn = baseSize(v.width, v.height, W, H);
        const k = Math.min(1, (drawn.w * Math.max(0.05, clip.transform.scale)) / v.width);
        const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
        const sink =
          k > 0.95
            ? new CanvasSink(v.track, { poolSize: 2 })
            : new CanvasSink(v.track, { width: even(v.width * k), height: even(v.height * k), fit: 'fill', poolSize: 2 });
        const startSec = clip.inPoint / fps;
        const endSec = (clip.inPoint + clip.duration) / fps + 1 / fps;
        r = new ClipReader(sink, startSec, endSec);
        readers.set(clip.id, r);
      }
      return r;
    };
    /** 끝난 클립의 디코더를 닫아 메모리를 돌려준다 */
    const closeFinished = async (frame: number) => {
      for (const track of edit.tracks) {
        for (const c of track.clips) {
          if (c.start + c.duration <= frame && readers.has(c.id)) {
            await readers.get(c.id)!.close();
            readers.delete(c.id);
          }
        }
      }
    };

    // 프레임마다 필요한 원본 그림을 미리 받아 둔 뒤 그린다 (drawFrame은 동기 함수)
    const pending = new Map<string, VisualSource | null>();
    const prepare = async (frame: number) => {
      pending.clear();
      for (const track of edit.tracks) {
        if (track.kind !== 'video') continue;
        const clip: Clip | undefined = clipAt(track, frame);
        if (!clip || clip.type === 'text' || clip.type === 'audio') continue;
        if (clip.type === 'image') {
          const b = images.get(clip.assetId);
          pending.set(clip.id, b ? { image: b, width: b.width, height: b.height } : null);
          continue;
        }
        const reader = readerFor(clip);
        if (!reader) {
          pending.set(clip.id, null);
          continue;
        }
        const t = (clip.inPoint + (frame - clip.start)) / fps;
        const wrapped = await reader.at(t);
        const v = videos.get(clip.assetId)!;
        // 크기는 원본 표시 크기로 넘긴다 → 줄여서 디코딩했어도 배치 계산은 미리보기와 같다
        pending.set(clip.id, wrapped ? { image: wrapped.canvas, width: v.width, height: v.height } : null);
      }
    };

    // 효과가 있으면 미리보기와 같은 WebGL 처리기를 이 Worker 안에 만든다 (같은 셰이더 코드)
    const effects = needsEffects(edit) ? createEffects() : null;
    const sources: FrameSources = {
      visual: (clip) => pending.get(clip.id) ?? null,
      text: (c, clip, frame) => drawTextClip(c, clip, W, H, frame),
      effects,
      effectScale: 1,
    };

    // 소리는 1초 분량씩 넣는다 (영상과 번갈아 → 메모리에 쌓이지 않게)
    let audioFramesSent = 0;
    const channels = audio?.numberOfChannels ?? 0;
    const totalAudioFrames = audio ? audio.interleaved.length / channels : 0;
    const sendAudioUpTo = async (sec: number) => {
      if (!audio || !audioSource) return;
      const want = Math.min(totalAudioFrames, Math.ceil(sec * audio.sampleRate));
      while (audioFramesSent < want) {
        const count = Math.min(audio.sampleRate, want - audioFramesSent); // 최대 1초
        const from = audioFramesSent * channels;
        const slice = audio.interleaved.subarray(from, from + count * channels);
        const sample = new AudioSample({
          data: slice,
          format: 'f32',
          numberOfChannels: channels,
          sampleRate: audio.sampleRate,
          timestamp: audioFramesSent / audio.sampleRate,
        });
        await audioSource.add(sample);
        sample.close();
        audioFramesSent += count;
      }
    };

    for (let frame = 0; frame < totalFrames; frame++) {
      if (canceled) break;
      await prepare(frame);
      drawFrame(ctx, edit, frame, sources);
      // await가 인코더의 속도에 맞춰 준다 (메모리가 무한히 늘지 않는다)
      await videoSource.add(frame / fps, 1 / fps);
      if (frame % fps === fps - 1) {
        await sendAudioUpTo((frame + 1) / fps);
        await closeFinished(frame + 1);
      }
      if (frame % 5 === 0 || frame === totalFrames - 1) {
        port.postMessage({ type: 'progress', frames: frame + 1, total: totalFrames, stage: 'video' });
      }
    }

    if (canceled) {
      await output.cancel();
      await cleanup();
      port.postMessage({ type: 'canceled' });
      return;
    }

    await sendAudioUpTo(totalFrames / fps);
    port.postMessage({ type: 'progress', frames: totalFrames, total: totalFrames, stage: 'finalize' });
    await output.finalize();
    await cleanup();

    const buffer = target instanceof BufferTarget ? target.buffer : null;
    const bytes = buffer?.byteLength ?? 0;
    port.postMessage({ type: 'done', buffer, bytes, ms: Math.round(performance.now() - t0) }, buffer ? [buffer] : []);
  } catch (e) {
    try {
      if (output.state === 'started' || output.state === 'pending') await output.cancel();
    } catch {
      /* 이미 정리됨 */
    }
    await cleanup();
    if (canceled) port.postMessage({ type: 'canceled' });
    else port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

port.onmessage = (e) => {
  const data = e.data;
  if ('type' in data && data.type === 'cancel') {
    canceled = true;
    return;
  }
  canceled = false;
  void run(data as ExportRequest);
};
