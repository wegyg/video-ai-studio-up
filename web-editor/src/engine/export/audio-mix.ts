/**
 * 내보내기용 소리 합치기 (메인 스레드).
 *
 * - Worker에는 Web Audio(OfflineAudioContext)가 없어서 여기서 합친다.
 * - 원본은 Mediabunny로 **클립이 쓰는 구간만** 읽는다. 파일 전체를 메모리에 올리지 않으므로
 *   휴대폰으로 찍은 큰 영상(수백 MB)도 빠르다.
 * - 표본율이 달라도(44.1kHz 등) 브라우저가 48kHz로 바꿔 준다.
 * - 볼륨·페이드는 미리보기와 같은 `gainAt`을 프레임마다 선형으로 이어 붙여 그대로 재현한다 (R8.4, G3).
 */
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny';
import { gainAt } from '../../model/audio';
import { isMedia } from '../../model/ops';
import { FPS, type AssetMeta, type EditState, type MediaClip } from '../../model/types';
import type { ExportAudio } from './protocol';

export const EXPORT_SAMPLE_RATE = 48000;

function interleave(buffer: AudioBuffer): Float32Array {
  const ch = buffer.numberOfChannels;
  const out = new Float32Array(buffer.length * ch);
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i * ch + c] = data[i];
  }
  return out;
}

/** 원본의 [from, to) 초 구간을 AudioBuffer 하나로 디코딩한다 (앞뒤로 삐져나온 부분은 잘라 낸다) */
async function decodeRange(track: InputAudioTrack, from: number, to: number): Promise<AudioBuffer | null> {
  let out: AudioBuffer | null = null;
  let rate = 0;
  let channels = 0;
  let length = 0;
  for await (const w of new AudioBufferSink(track).buffers(from, to)) {
    if (!out) {
      rate = w.buffer.sampleRate;
      channels = w.buffer.numberOfChannels;
      length = Math.max(1, Math.round((to - from) * rate));
      out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: rate });
    }
    const offset = Math.round((w.timestamp - from) * rate); // 첫 조각은 구간보다 앞에서 시작할 수 있다(음수)
    for (let c = 0; c < channels; c++) {
      const src = w.buffer.getChannelData(Math.min(c, w.buffer.numberOfChannels - 1));
      const dst = out.getChannelData(c);
      const s0 = Math.max(0, -offset);
      const d0 = Math.max(0, offset);
      const n = Math.min(src.length - s0, length - d0);
      if (n > 0) dst.set(src.subarray(s0, s0 + n), d0);
    }
  }
  return out;
}

/** 소리를 낼 클립 모으기 (음소거 트랙 제외) */
function collect(edit: EditState, assets: Record<string, AssetMeta>): MediaClip[] {
  const out: MediaClip[] = [];
  for (const track of edit.tracks) {
    if (track.kind === 'text' || track.muted) continue;
    for (const clip of track.clips) {
      if (!isMedia(clip) || clip.type === 'image') continue;
      if (!assets[clip.assetId]?.hasAudio) continue;
      out.push(clip);
    }
  }
  return out;
}

/** 소리가 있는 클립이 하나도 없으면 null */
export async function mixExportAudio(
  edit: EditState,
  assets: Record<string, AssetMeta>,
  blobs: Record<string, Blob>,
  totalFrames: number,
): Promise<ExportAudio | null> {
  const clips = collect(edit, assets);
  if (!clips.length || totalFrames <= 0) return null;

  const length = Math.ceil((totalFrames / FPS) * EXPORT_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, length, EXPORT_SAMPLE_RATE);
  const inputs = new Map<string, Input>();
  let placed = 0;
  try {
    for (const clip of clips) {
      const blob = blobs[clip.assetId];
      if (!blob) continue;
      let input = inputs.get(clip.assetId);
      if (!input) {
        input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
        inputs.set(clip.assetId, input);
      }
      const track = await input.getPrimaryAudioTrack();
      if (!track || !(await track.canDecode())) continue; // 소리를 읽을 수 없는 파일은 건너뛴다 (가져올 때 이미 알렸다)
      const buf = await decodeRange(track, clip.inPoint / FPS, (clip.inPoint + clip.duration) / FPS);
      if (!buf) continue;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      const startSec = clip.start / FPS;
      // 프레임마다 선형으로 이어 붙이면 gainAt 곡선과 프레임 경계에서 정확히 같아진다
      const endFrame = clip.start + Math.min(clip.duration, Math.round(buf.duration * FPS));
      gain.gain.setValueAtTime(gainAt(clip, clip.start), startSec);
      for (let f = clip.start + 1; f <= endFrame; f++) gain.gain.linearRampToValueAtTime(gainAt(clip, f), f / FPS);
      src.connect(gain).connect(ctx.destination);
      src.start(startSec);
      placed++;
    }
  } finally {
    for (const i of inputs.values()) i.dispose();
  }
  if (!placed) return null;
  const rendered = await ctx.startRendering();
  return { sampleRate: rendered.sampleRate, numberOfChannels: rendered.numberOfChannels, interleaved: interleave(rendered) };
}
