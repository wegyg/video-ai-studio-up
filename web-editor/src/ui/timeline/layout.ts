import type { TrackKind } from '../../model/types';
import { ZOOM_MAX, ZOOM_MIN } from '../../store/ui';

/** 트랙 이름 칸 너비, 눈금 높이 (px) */
export const HEADER_W = 132;
export const RULER_H = 28;
export const ROW_H: Record<TrackKind, number> = { text: 36, video: 64, audio: 48 };
/** 프로젝트 끝 뒤에 남겨 두는 여유 (프레임) */
export const TAIL_FRAMES = 30 * 30;

/** 줌 슬라이더(0~1000) ↔ 프레임당 픽셀 (로그 눈금) */
export const SLIDER_MAX = 1000;
export const zoomToSlider = (z: number): number =>
  Math.round((SLIDER_MAX * Math.log(z / ZOOM_MIN)) / Math.log(ZOOM_MAX / ZOOM_MIN));
export const sliderToZoom = (v: number): number => ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, v / SLIDER_MAX);

/** 눈금 간격 후보 (프레임) */
const STEPS = [1, 5, 10, 15, 30, 60, 150, 300, 600, 900, 1800, 3600, 9000, 18000];

/** 큰 눈금 간격: 화면에서 90px 이상 벌어지는 가장 작은 간격 */
export function rulerSteps(pxPerFrame: number): { major: number; minor: number | null } {
  const major = STEPS.find((s) => s * pxPerFrame >= 90) ?? STEPS[STEPS.length - 1];
  for (const div of [5, 2]) {
    const minor = major / div;
    if (Number.isInteger(minor) && minor * pxPerFrame >= 6) return { major, minor };
  }
  return { major, minor: null };
}
