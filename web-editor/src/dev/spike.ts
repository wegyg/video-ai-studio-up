/**
 * 태스크 0 기술 검증 스파이크. 이 브라우저에서 1단계 핵심 경로가 실제로 되는지 확인한다.
 *  1) Mediabunny로 H.264 mp4 디코딩 (CanvasSink) + 픽셀 확인
 *  2) Mediabunny로 1080x1920 30fps H.264 + AAC MP4 인코딩 (CanvasSource + AudioBufferSource)
 *  3) 인코딩 결과를 다시 읽어 코덱/해상도/길이 확인
 *  4) 앱에 포함한 한글 글꼴 로드
 * 테스트에서만 불러오는 별도 청크다.
 */
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferSource as MbBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import type { SpikeResult } from '../debug-types';
import { detectSupport } from '../support';
import { loadAllFonts } from '../fonts';

function readPixel(src: CanvasImageSource, w: number, h: number, x: number, y: number): number[] {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}

export async function runSpike(video: Blob): Promise<SpikeResult> {
  const support = await detectSupport();

  // 1) 디코딩
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(video) });
  const vt = await input.getPrimaryVideoTrack();
  if (!vt) throw new Error('영상 트랙 없음');
  const decode = {
    codec: await vt.getCodec(),
    canDecode: await vt.canDecode(),
    duration: await input.computeDuration(),
    width: await vt.getDisplayWidth(),
    height: await vt.getDisplayHeight(),
    pixelAt2_5s: [] as number[],
  };
  const sink = new CanvasSink(vt, { width: 54, height: 96, fit: 'fill' });
  const wc = await sink.getCanvas(2.5); // 2~3초 구간은 파랑
  if (wc) decode.pixelAt2_5s = readPixel(wc.canvas, 54, 96, 27, 48);
  input.dispose();

  // 2) 인코딩: 1080x1920, 30fps, 2초
  const aacPath: 'native' | 'wasm' = support.aacEncodeNative ? 'native' : 'wasm';
  if (aacPath === 'wasm') {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  }
  await loadAllFonts();
  const W = 1080;
  const H = 1920;
  const FRAMES = 60;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vsrc = new CanvasSource(canvas, { codec: 'avc', bitrate: 10_000_000 });
  output.addVideoTrack(vsrc, { frameRate: 30 });
  const asrc = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 });
  output.addAudioTrack(asrc);
  await output.start();

  const t0 = performance.now();
  for (let i = 0; i < FRAMES; i++) {
    ctx.fillStyle = `hsl(${(i * 6) % 360} 80% 45%)`;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = '700 160px Pretendard';
    ctx.fillText(`한글 ${i}`, 120, 960);
    await vsrc.add(i / 30, 1 / 30);
  }
  const sr = 48000;
  const ab = new AudioBuffer({ length: (sr * FRAMES) / 30, numberOfChannels: 2, sampleRate: sr });
  for (let ch = 0; ch < 2; ch++) {
    const data = ab.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr);
  }
  await asrc.add(ab);
  await output.finalize();
  const encodeMs = performance.now() - t0;
  const buf = output.target.buffer!;

  // 3) 결과 다시 읽기
  const check = new Input({ formats: ALL_FORMATS, source: new MbBufferSource(buf) });
  const ov = await check.getPrimaryVideoTrack();
  const oa = await check.getPrimaryAudioTrack();
  const out = {
    videoCodec: ov ? await ov.getCodec() : null,
    audioCodec: oa ? await oa.getCodec() : null,
    width: ov ? await ov.getDisplayWidth() : 0,
    height: ov ? await ov.getDisplayHeight() : 0,
    duration: await check.computeDuration(),
  };
  check.dispose();

  // 4) 글꼴
  const faces = [...(document.fonts as unknown as Iterable<FontFace>)];
  const isLoaded = (family: string, weight: string) =>
    faces.some((f) => f.family.replace(/["']/g, '') === family && f.weight === weight && f.status === 'loaded');
  const fonts: Record<string, boolean> = {};
  for (const fam of ['Pretendard', 'Noto Sans KR']) for (const w of ['400', '700', '900']) fonts[`${fam} ${w}`] = isLoaded(fam, w);

  return {
    support: { ...support },
    decode,
    encode: { aacPath, frames: FRAMES, encodeMs: Math.round(encodeMs), fps: Math.round((FRAMES / encodeMs) * 1000), bytes: buf.byteLength, out },
    fonts,
  };
}
