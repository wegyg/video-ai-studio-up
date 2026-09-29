/**
 * 미리보기 직접 조작에 쓰는 기하 계산 (순수 함수, 단위 테스트 대상).
 * 좌표계는 프로젝트 해상도(예: 1080×1920) 기준이다. 회전은 도(°), 시계 방향.
 */
import type { Transform } from '../model/types';
import { baseSize } from './compose';

export interface Point {
  x: number;
  y: number;
}

/** 화면에 놓인 클립의 사각형: 가운데점, 크기, 회전 */
export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

export type CornerId = 'tl' | 'tr' | 'br' | 'bl';
/** 드래그 종류: 모서리 4개 + 회전 */
export type HandleId = CornerId | 'rot';
export const CORNERS: CornerId[] = ['tl', 'tr', 'br', 'bl'];

const rad = (deg: number) => (deg * Math.PI) / 180;

/** 소스 크기 + Transform → 화면 사각형. compose.ts와 같은 맞춤(contain) 규칙을 쓴다. */
export function clipBox(srcW: number, srcH: number, t: Transform, W: number, H: number): Box {
  const { w, h } = baseSize(srcW, srcH, W, H);
  return { cx: W / 2 + t.x, cy: H / 2 + t.y, w: w * t.scale, h: h * t.scale, rotation: t.rotation };
}

/**
 * 텍스트 사각형. 글자 배치 결과가 이미 프로젝트 좌표 크기라서 맞춤 계산을 하지 않는다.
 */
export function textBox(layoutW: number, layoutH: number, t: Transform, W: number, H: number): Box {
  return { cx: W / 2 + t.x, cy: H / 2 + t.y, w: layoutW * t.scale, h: layoutH * t.scale, rotation: t.rotation };
}

/** 화면 좌표 → 사각형 기준 좌표(회전을 되돌린 좌표) */
export function toLocal(p: Point, box: Box): Point {
  const dx = p.x - box.cx;
  const dy = p.y - box.cy;
  const a = rad(-box.rotation);
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

/** 사각형 기준 좌표 → 화면 좌표 */
export function toCanvas(p: Point, box: Box): Point {
  const a = rad(box.rotation);
  return {
    x: box.cx + p.x * Math.cos(a) - p.y * Math.sin(a),
    y: box.cy + p.x * Math.sin(a) + p.y * Math.cos(a),
  };
}

/** 점이 사각형 안에 있는지 (회전 고려). pad는 여유(프로젝트 px). */
export function containsPoint(p: Point, box: Box, pad = 0): boolean {
  const l = toLocal(p, box);
  return Math.abs(l.x) <= box.w / 2 + pad && Math.abs(l.y) <= box.h / 2 + pad;
}

/** 사각형 기준 좌표에서의 모서리 위치 */
export function cornerLocal(id: CornerId, box: Box): Point {
  const hw = box.w / 2;
  const hh = box.h / 2;
  switch (id) {
    case 'tl':
      return { x: -hw, y: -hh };
    case 'tr':
      return { x: hw, y: -hh };
    case 'br':
      return { x: hw, y: hh };
    case 'bl':
      return { x: -hw, y: hh };
  }
}

/** 모서리 핸들의 화면 좌표 */
export function handlePoint(id: CornerId, box: Box): Point {
  return toCanvas(cornerLocal(id, box), box);
}

/** 각도를 -180 초과 ~ 180 이하로 정규화 */
export function normalizeAngle(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a === -180) a = 180;
  return a;
}

/** step의 배수에 tol 이내로 가까우면 붙인다 (회전 자석) */
export function snapAngle(deg: number, step = 15, tol = 5): number {
  const near = Math.round(deg / step) * step;
  return Math.abs(normalizeAngle(deg - near)) <= tol ? normalizeAngle(near) : normalizeAngle(deg);
}

/**
 * 모서리를 끌었을 때의 새 배율.
 * 가운데에서 잡은 모서리까지의 거리 비율로 정한다(비율 유지). 최솟값 0.02.
 */
export function scaleFromCorner(pointer: Point, box: Box, startScale: number): number {
  const half = Math.hypot(box.w / 2, box.h / 2);
  if (half < 1e-6) return startScale;
  const dist = Math.hypot(pointer.x - box.cx, pointer.y - box.cy);
  return Math.max(0.02, (dist / half) * startScale);
}

/** 회전 핸들을 끌었을 때의 새 회전 각도(도) */
export function rotationFromPointer(pointer: Point, box: Box): number {
  const a = Math.atan2(pointer.y - box.cy, pointer.x - box.cx);
  // 위쪽(-90°)을 잡고 있으므로 90°를 더해 위쪽이 0°가 되게 한다
  return normalizeAngle((a * 180) / Math.PI + 90);
}
