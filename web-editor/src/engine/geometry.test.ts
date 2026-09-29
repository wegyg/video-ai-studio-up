import { describe, expect, it } from 'vitest';
import {
  clipBox,
  containsPoint,
  handlePoint,
  normalizeAngle,
  rotationFromPointer,
  scaleFromCorner,
  snapAngle,
  toCanvas,
  toLocal,
  type Box,
} from './geometry';
import { DEFAULT_TRANSFORM } from '../model/ops';

const W = 1080;
const H = 1920;
const t = (p: Partial<typeof DEFAULT_TRANSFORM> = {}) => ({ ...DEFAULT_TRANSFORM, ...p });

describe('clipBox', () => {
  it('세로 캔버스에 가로 소스: 너비를 채우고 가운데', () => {
    const b = clipBox(1920, 1080, t(), W, H);
    expect([b.cx, b.cy, b.w, Math.round(b.h)]).toEqual([540, 960, 1080, 608]);
  });
  it('같은 비율이면 캔버스를 꽉 채운다', () => {
    const b = clipBox(540, 960, t(), W, H);
    expect([b.w, b.h]).toEqual([1080, 1920]);
  });
  it('위치·배율·회전이 반영된다', () => {
    const b = clipBox(1080, 1080, t({ x: 100, y: -50, scale: 0.5, rotation: 30 }), W, H);
    expect([b.cx, b.cy, b.w, b.h, b.rotation]).toEqual([640, 910, 540, 540, 30]);
  });
});

describe('좌표 변환', () => {
  const box: Box = { cx: 540, cy: 960, w: 400, h: 200, rotation: 0 };
  it('가운데는 (0,0)', () => expect(toLocal({ x: 540, y: 960 }, box)).toEqual({ x: 0, y: 0 }));
  it('회전 90°면 화면 오른쪽은 기준 좌표에서 아래', () => {
    const r: Box = { ...box, rotation: 90 };
    const l = toLocal({ x: 640, y: 960 }, r);
    expect(l.x).toBeCloseTo(0);
    expect(l.y).toBeCloseTo(-100);
  });
  it('toLocal과 toCanvas는 서로 반대', () => {
    const r: Box = { ...box, rotation: 37 };
    const p = { x: 700, y: 1000 };
    const back = toCanvas(toLocal(p, r), r);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});

describe('containsPoint (회전 고려)', () => {
  const box: Box = { cx: 540, cy: 960, w: 400, h: 200, rotation: 0 };
  it('안쪽/바깥', () => {
    expect(containsPoint({ x: 540, y: 960 }, box)).toBe(true);
    expect(containsPoint({ x: 739, y: 960 }, box)).toBe(true);
    expect(containsPoint({ x: 741, y: 960 }, box)).toBe(false);
    expect(containsPoint({ x: 540, y: 1061 }, box)).toBe(false);
  });
  it('90° 회전하면 판정도 돌아간다', () => {
    const r: Box = { ...box, rotation: 90 };
    expect(containsPoint({ x: 540, y: 1150 }, r)).toBe(true); // 긴 변이 세로로
    expect(containsPoint({ x: 700, y: 960 }, r)).toBe(false);
  });
  it('여유(pad)를 주면 조금 밖도 포함', () => {
    expect(containsPoint({ x: 745, y: 960 }, box, 10)).toBe(true);
  });
});

describe('handlePoint', () => {
  const box: Box = { cx: 500, cy: 500, w: 200, h: 100, rotation: 0 };
  it('모서리 4개', () => {
    expect(handlePoint('tl', box)).toEqual({ x: 400, y: 450 });
    expect(handlePoint('tr', box)).toEqual({ x: 600, y: 450 });
    expect(handlePoint('br', box)).toEqual({ x: 600, y: 550 });
    expect(handlePoint('bl', box)).toEqual({ x: 400, y: 550 });
  });
  it('180° 회전하면 좌우상하가 바뀐다', () => {
    const r: Box = { ...box, rotation: 180 };
    const p = handlePoint('tl', r);
    expect(p.x).toBeCloseTo(600);
    expect(p.y).toBeCloseTo(550);
  });
});

describe('각도', () => {
  it('정규화', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(540)).toBe(180);
  });
  it('15° 자석: 가까우면 붙고 멀면 그대로', () => {
    expect(snapAngle(13)).toBe(15);
    expect(snapAngle(2)).toBe(0);
    expect(snapAngle(22)).toBe(22);
    expect(snapAngle(-88)).toBe(-90);
    expect(snapAngle(37, 15, 5)).toBe(37);
  });
  it('회전 핸들 각도: 위쪽이 0°, 오른쪽이 90°', () => {
    const box: Box = { cx: 0, cy: 0, w: 100, h: 100, rotation: 0 };
    expect(rotationFromPointer({ x: 0, y: -100 }, box)).toBeCloseTo(0);
    expect(rotationFromPointer({ x: 100, y: 0 }, box)).toBeCloseTo(90);
    expect(rotationFromPointer({ x: 0, y: 100 }, box)).toBeCloseTo(180);
    expect(rotationFromPointer({ x: -100, y: 0 }, box)).toBeCloseTo(-90);
  });
});

describe('scaleFromCorner', () => {
  const box: Box = { cx: 0, cy: 0, w: 200, h: 200, rotation: 0 };
  it('모서리 거리 비율로 배율을 정한다', () => {
    const half = Math.hypot(100, 100);
    expect(scaleFromCorner({ x: 100, y: 100 }, box, 1)).toBeCloseTo(1);
    expect(scaleFromCorner({ x: 200, y: 200 }, box, 1)).toBeCloseTo(2);
    expect(scaleFromCorner({ x: half / 2, y: 0 }, box, 1)).toBeCloseTo(0.5);
  });
  it('시작 배율에 비례한다', () => {
    expect(scaleFromCorner({ x: 200, y: 200 }, box, 0.5)).toBeCloseTo(1);
  });
  it('0 이하로 내려가지 않는다', () => {
    expect(scaleFromCorner({ x: 0, y: 0 }, box, 1)).toBe(0.02);
  });
});
