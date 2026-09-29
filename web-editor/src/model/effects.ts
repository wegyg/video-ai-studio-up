/**
 * 영상 효과 6종 (R15): 흔들림, 번쩍임, 줌 펄스, 흑백, 레트로, 블러. 클립마다 켜고 강도(0~100)를 정한다.
 * 계산은 WebGL 셰이더(src/engine/gl/effects.ts의 FS_FILTER)가 하고, 여기서는 셰이더에 넘길 값만 만든다.
 * 시간에 따라 변하는 효과(흔들림·번쩍임·줌 펄스)는 클립 시작부터의 시간으로 정해진다 → 미리보기 = 내보내기.
 */
import type { MediaClip, VideoEffectKind } from './types';

export const VIDEO_EFFECTS: VideoEffectKind[] = ['shake', 'flash', 'zoom-pulse', 'mono', 'retro', 'blur'];
/** 멈춘 화면 한 장으로는 보이지 않는 효과 — 켜면 잠깐 재생해 보여 준다 */
export const TIME_VARYING: ReadonlySet<VideoEffectKind> = new Set(['shake', 'flash', 'zoom-pulse']);
/** 켤 때 기본 강도: 흑백·레트로는 완전히, 움직이는 효과와 블러는 60% */
export const EFFECT_DEFAULT: Record<VideoEffectKind, number> = { shake: 60, flash: 60, 'zoom-pulse': 60, mono: 100, retro: 100, blur: 60 };

/** 셰이더에 넘기는 효과 값 (강도 0~1, 시간) */
export interface EffectParams {
  shake: number;
  flash: number;
  zoom: number;
  mono: number;
  retro: number;
  blur: number;
  /** 클립 시작부터의 시간(초)과 프레임 번호 */
  t: number;
  frame: number;
}

export const effectIntensity = (c: Pick<MediaClip, 'effects'>, kind: VideoEffectKind): number => c.effects?.find((e) => e.kind === kind)?.intensity ?? 0;

/** 이 프레임에 셰이더로 넘길 값. 켠 효과가 없으면 null */
export function clipEffects(c: MediaClip, frame: number, fps: number): EffectParams | null {
  if (!c.effects?.some((e) => e.intensity > 0)) return null;
  const k = (kind: VideoEffectKind) => Math.max(0, Math.min(100, effectIntensity(c, kind))) / 100;
  const local = Math.max(0, Math.round(frame - c.start));
  return { shake: k('shake'), flash: k('flash'), zoom: k('zoom-pulse'), mono: k('mono'), retro: k('retro'), blur: k('blur'), t: local / fps, frame: local };
}

/** 효과 켜기/끄기 (켜면 기본 강도) */
export function toggleEffect(c: MediaClip, kind: VideoEffectKind): MediaClip {
  const list = c.effects ?? [];
  const has = list.some((e) => e.kind === kind);
  const next = has ? list.filter((e) => e.kind !== kind) : [...list, { kind, intensity: EFFECT_DEFAULT[kind] }];
  const out: MediaClip = { ...c };
  if (next.length) out.effects = VIDEO_EFFECTS.flatMap((k) => next.filter((e) => e.kind === k));
  else delete out.effects;
  return out;
}

export function setEffectIntensity(c: MediaClip, kind: VideoEffectKind, intensity: number): MediaClip {
  const v = Math.max(0, Math.min(100, Math.round(intensity)));
  if (!c.effects?.some((e) => e.kind === kind && e.intensity !== v)) return c;
  return { ...c, effects: c.effects.map((e) => (e.kind === kind ? { ...e, intensity: v } : e)) };
}
