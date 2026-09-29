/**
 * BGM 자동 덕킹 (R19): "덕킹"을 켠 오디오 클립은 다른 소리(말소리·영상 소리·다른 오디오)가 나오는 동안 줄어든다.
 * 미리보기(GainNode)와 내보내기(OfflineAudioContext)가 같은 함수·같은 파형 자료(피크, 초당 100개)로 계산한다.
 *
 * - 다른 소리가 있는지: 그 순간 원본 피크 × 그 클립의 소리 크기(gainAt)가 THRESHOLD를 넘으면 "있음"
 * - 말이 시작되기 ATTACK 프레임 전부터 줄이기 시작해 시작 순간에는 다 줄어 있고, 끝나면 RELEASE 프레임에 걸쳐 돌아온다
 * - 소리 크기 = 원래 크기 × (1 − 덕킹 정도 × (1 − duck))  (duck = 줄였을 때의 크기, 예: 0.3)
 */
import { gainAt } from './audio';
import { srcAt } from './transitions';
import { FPS, type AssetMeta, type EditState, type MediaClip } from './types';

export const DUCK_THRESHOLD = 0.05;
export const DUCK_ATTACK = 6;
export const DUCK_RELEASE = 15;
/** 덕킹을 켰을 때 기본 크기 (30%) */
export const DUCK_DEFAULT = 0.3;
/** 파형 피크: 초당 구간 수 (media/derive-protocol.ts의 PEAKS_PER_SEC와 같다) */
const PEAKS_PER_SEC = 100;

export const isDucked = (c: MediaClip): boolean => c.type === 'audio' && c.duck !== undefined;

/** 소리를 내는 클립인지 (음소거 트랙·분리된 영상 소리·소리 없는 파일 제외) */
function audible(c: MediaClip, assets: Record<string, AssetMeta>): boolean {
  if (c.type === 'image' || !assets[c.assetId]?.hasAudio) return false;
  return !(c.type === 'video' && c.audioDetached);
}

/** 이 클립이 타임라인 프레임 f 동안 내는 소리의 최대 크기 (피크 × 소리 크기) */
function levelAt(c: MediaClip, f: number, peaks: Float32Array): number {
  const a = Math.floor((srcAt(c, f) / FPS) * PEAKS_PER_SEC);
  const b = Math.max(a + 1, Math.floor((srcAt(c, f + 1) / FPS) * PEAKS_PER_SEC));
  let m = 0;
  for (let i = Math.max(0, a); i < Math.min(peaks.length, b); i++) if (peaks[i] > m) m = peaks[i];
  return m * gainAt(c, f + 0.5);
}

/**
 * 타임라인 전체의 덕킹 정도 (프레임마다 0~1). 덕킹할 클립이 없으면 null.
 * @param peaksOf 자산 id → 파형 피크 (없으면 그 소리는 감지하지 못한다 — 미리보기·내보내기 모두 같다)
 */
export function duckEnvelope(
  edit: EditState,
  assets: Record<string, AssetMeta>,
  peaksOf: (assetId: string) => Float32Array | undefined,
  totalFrames: number,
): Float32Array | null {
  const voices: MediaClip[] = [];
  let any = false;
  for (const t of edit.tracks) {
    if (t.kind === 'text') continue;
    for (const c of t.clips) {
      if (c.type !== 'video' && c.type !== 'image' && c.type !== 'audio') continue;
      if (isDucked(c)) any = true;
      else if (!t.muted && audible(c, assets)) voices.push(c);
    }
  }
  if (!any || totalFrames <= 0) return null;
  const present = new Uint8Array(totalFrames);
  for (const c of voices) {
    const peaks = peaksOf(c.assetId);
    if (!peaks) continue;
    const end = Math.min(totalFrames, c.start + c.duration);
    for (let f = Math.max(0, c.start); f < end; f++) if (!present[f] && levelAt(c, f, peaks) > DUCK_THRESHOLD) present[f] = 1;
  }
  // 앞당겨 보기: 말이 시작되는 순간에 이미 다 줄어 있도록 ATTACK 프레임 전부터 목표를 1로
  const target = new Uint8Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    if (!present[f]) continue;
    for (let k = Math.max(0, f - DUCK_ATTACK); k <= f; k++) target[k] = 1;
  }
  const env = new Float32Array(totalFrames);
  let e = 0;
  for (let f = 0; f < totalFrames; f++) {
    e = target[f] ? Math.min(1, e + 1 / DUCK_ATTACK) : Math.max(0, e - 1 / DUCK_RELEASE);
    env[f] = e;
  }
  return env;
}

/** 덕킹 클립의 소리 크기 배율 (프레임 f, 소수 가능 — 프레임 사이는 직선으로 잇는다) */
export function duckFactor(c: MediaClip, env: Float32Array | null, f: number): number {
  if (!env || !isDucked(c)) return 1;
  const i = Math.max(0, Math.min(env.length - 1, Math.floor(f)));
  const j = Math.min(env.length - 1, i + 1);
  const u = Math.max(0, Math.min(1, f - i));
  const e = env[i] + (env[j] - env[i]) * u;
  return 1 - e * (1 - (c.duck ?? 1));
}
