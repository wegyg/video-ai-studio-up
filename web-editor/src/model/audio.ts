/**
 * 클립 소리 크기 곡선 (R8.1, R8.2, R8.4): 볼륨 × 페이드 인 × 페이드 아웃 (선형).
 * 미리보기(GainNode)와 내보내기(OfflineAudioContext)가 같은 함수를 써서 결과가 같다.
 */
import type { MediaClip } from './types';

/** 타임라인 프레임 f(소수 가능)에서의 이득. 클립 밖이면 0 */
export function gainAt(clip: Pick<MediaClip, 'start' | 'duration' | 'volume' | 'fadeIn' | 'fadeOut'>, f: number): number {
  const t = f - clip.start;
  if (t < 0 || t > clip.duration) return 0;
  let g = clip.volume;
  if (clip.fadeIn > 0 && t < clip.fadeIn) g *= t / clip.fadeIn;
  const rest = clip.duration - t;
  if (clip.fadeOut > 0 && rest < clip.fadeOut) g *= rest / clip.fadeOut;
  return Math.max(0, g);
}
