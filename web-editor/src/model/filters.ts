/**
 * 필터 프리셋 12종과 색 조정 계산식 (R15).
 *
 * `adjustPixel`은 WebGL 셰이더(src/engine/gl/effects.ts의 FS_FILTER)와 **같은 계산**을 한다.
 * 셰이더를 고치면 이 함수도 같이 고쳐야 한다. 테스트가 둘의 결과를 비교한다.
 */
import { transitionsOf } from './transitions';
import type { CanvasBackground, ClipFilter, ColorAdjust, EditState, MediaClip } from './types';

export const NEUTRAL_ADJUST: ColorAdjust = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0, vignette: 0 };

export const ADJUST_KEYS: (keyof ColorAdjust)[] = ['brightness', 'contrast', 'saturation', 'temperature', 'sharpness', 'vignette'];

/** 슬라이더 범위 */
export const ADJUST_RANGE: Record<keyof ColorAdjust, [number, number]> = {
  brightness: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 100],
  temperature: [-100, 100],
  sharpness: [0, 100],
  vignette: [0, 100],
};

export const DEFAULT_BACKGROUND: CanvasBackground = { kind: 'color', color: '#000000' };
export const DEFAULT_BLUR_AMOUNT = 50;

export interface FilterPreset {
  id: string;
  adjust: ColorAdjust;
}

const p = (id: string, a: Partial<ColorAdjust>): FilterPreset => ({ id, adjust: { ...NEUTRAL_ADJUST, ...a } });

/** 12종. 모두 색 계산이 하나 이상 들어 있어 단색 화면에서도 차이가 보인다 */
export const FILTER_PRESETS: FilterPreset[] = [
  p('vivid', { contrast: 15, saturation: 30 }),
  p('warm', { temperature: 40, saturation: 10 }),
  p('cool', { temperature: -40, brightness: 3 }),
  p('bright', { brightness: 15, contrast: -8, saturation: 12 }),
  p('food', { temperature: 22, saturation: 35, contrast: 10 }),
  p('portrait', { brightness: 8, contrast: -10, saturation: -8, temperature: 12 }),
  p('cinema', { contrast: 22, saturation: -18, temperature: -12, vignette: 35 }),
  p('vintage', { saturation: -35, temperature: 28, contrast: -12, vignette: 40 }),
  p('mono', { saturation: -100, contrast: 12 }),
  p('dramatic', { contrast: 38, brightness: -10, vignette: 50 }),
  p('soft', { contrast: -22, brightness: 6, saturation: -6 }),
  p('crisp', { sharpness: 60, contrast: 10, saturation: 8 }),
];

export const isNeutralAdjust = (a: ColorAdjust | undefined): boolean => !a || ADJUST_KEYS.every((k) => a[k] === 0);

/** 클립에 실제로 적용할 조정 값 (없으면 null) */
export function clipAdjust(c: Pick<MediaClip, 'filter'>): ColorAdjust | null {
  const a = c.filter?.adjust;
  return a && !isNeutralAdjust(a) ? a : null;
}

export function presetFilter(id: string): ClipFilter | null {
  const preset = FILTER_PRESETS.find((f) => f.id === id);
  return preset ? { preset: preset.id, adjust: { ...preset.adjust } } : null;
}

/** 이 편집에 WebGL 효과가 필요한지 (필요 없으면 효과 처리기를 만들지 않는다) */
export function needsEffects(edit: EditState): boolean {
  if (edit.background?.kind === 'blur') return true;
  for (const t of edit.tracks) {
    if (t.kind === 'video' && transitionsOf(t).length) return true;
    for (const c of t.clips) if ((c.type === 'video' || c.type === 'image') && (clipAdjust(c) || c.effects?.some((e) => e.intensity > 0))) return true;
  }
  return false;
}

const LUMA = [0.2126, 0.7152, 0.0722];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 한 픽셀의 색 조정 (0~255 입력 → 0~255 출력). 선명도·비네트는 주변/위치에 따라 달라서 여기서는 뺀다
 * (단색 화면의 가운데라면 둘 다 결과에 영향이 없다).
 */
export function adjustPixel(rgb: readonly number[], a: ColorAdjust): number[] {
  const b = a.brightness / 100;
  const c = a.contrast / 100;
  const s = a.saturation / 100;
  const t = a.temperature / 100;
  let [r, g, bl] = rgb.map((v) => v / 255);
  r += b * 0.3;
  g += b * 0.3;
  bl += b * 0.3;
  r = (r - 0.5) * (1 + c) + 0.5;
  g = (g - 0.5) * (1 + c) + 0.5;
  bl = (bl - 0.5) * (1 + c) + 0.5;
  const l = r * LUMA[0] + g * LUMA[1] + bl * LUMA[2];
  r = l + (r - l) * (1 + s);
  g = l + (g - l) * (1 + s);
  bl = l + (bl - l) * (1 + s);
  r += t * 0.1;
  g += t * 0.02;
  bl -= t * 0.1;
  return [r, g, bl].map((v) => Math.round(clamp01(v) * 255));
}
