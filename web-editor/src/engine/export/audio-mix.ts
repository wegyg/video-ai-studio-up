/**
 * 내보내기용 소리 합치기 (메인 스레드).
 *
 * Worker에는 Web Audio(OfflineAudioContext)가 없어서 여기서 합친다.
 * 브라우저가 표본율 변환(44.1kHz → 48kHz)까지 해 주므로 직접 변환기를 만들지 않는다.
 * 볼륨·페이드는 미리보기와 같은 `gainAt`을 프레임마다 선형으로 이어 붙여 그대로 재현한다 (R8.4, G3).
 */
import { gainAt } from '../../model/audio';
import { isMedia } from '../../model/ops';
import { FPS, type AssetMeta, type EditState } from '../../model/types';
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

  // 같은 파일은 한 번만 디코딩한다
  const decoded = new Map<string, AudioBuffer>();
  for (const clip of clips) {
    const blob = blobs[clip.assetId];
    if (!blob) continue;
    let buf = decoded.get(clip.assetId);
    if (!buf) {
      try {
        buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      } catch {
        continue; // 소리를 읽을 수 없는 파일은 건너뛴다 (가져올 때 이미 알렸다)
      }
      decoded.set(clip.assetId, buf);
    }
    const startSec = clip.start / FPS;
    const offsetSec = clip.inPoint / FPS;
    const durSec = Math.min(clip.duration / FPS, Math.max(0, buf.duration - offsetSec));
    if (durSec <= 0) continue;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    // 프레임마다 선형으로 이어 붙이면 gainAt 곡선과 프레임 경계에서 정확히 같아진다
    const endFrame = clip.start + Math.round(durSec * FPS);
    gain.gain.setValueAtTime(gainAt(clip, clip.start), startSec);
    for (let f = clip.start + 1; f <= endFrame; f++) {
      gain.gain.linearRampToValueAtTime(gainAt(clip, f), f / FPS);
    }
    src.connect(gain).connect(ctx.destination);
    src.start(startSec, offsetSec, durSec);
  }

  if (!decoded.size) return null;
  const rendered = await ctx.startRendering();
  return { sampleRate: rendered.sampleRate, numberOfChannels: rendered.numberOfChannels, interleaved: interleave(rendered) };
}

/** 소리를 낼 클립 모으기 (음소거 트랙 제외) */
function collect(edit: EditState, assets: Record<string, AssetMeta>) {
  const out = [];
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
