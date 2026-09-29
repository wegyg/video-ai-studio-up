import { describe, expect, it } from 'vitest';
import { gainAt } from './audio';

const clip = { start: 100, duration: 90, volume: 1, fadeIn: 0, fadeOut: 0 };

describe('gainAt (볼륨 × 페이드)', () => {
  it('클립 밖은 0, 안은 볼륨', () => {
    expect(gainAt(clip, 99)).toBe(0);
    expect(gainAt(clip, 191)).toBe(0);
    expect(gainAt(clip, 150)).toBe(1);
    expect(gainAt({ ...clip, volume: 1.5 }, 150)).toBe(1.5);
  });
  it('페이드 인: 시작 0 → 끝에서 볼륨', () => {
    const c = { ...clip, volume: 0.8, fadeIn: 30 };
    expect(gainAt(c, 100)).toBe(0);
    expect(gainAt(c, 115)).toBeCloseTo(0.4);
    expect(gainAt(c, 130)).toBeCloseTo(0.8);
  });
  it('페이드 아웃: 끝에서 0', () => {
    const c = { ...clip, fadeOut: 30 };
    expect(gainAt(c, 160)).toBeCloseTo(1);
    expect(gainAt(c, 175)).toBeCloseTo(0.5);
    expect(gainAt(c, 190)).toBeCloseTo(0);
  });
  it('페이드가 겹치면 곱해진다', () => {
    const c = { ...clip, fadeIn: 90, fadeOut: 90 };
    expect(gainAt(c, 145)).toBeCloseTo(0.25);
  });
});
