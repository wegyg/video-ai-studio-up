/** E2E 공용 도우미 */
import { expect, type Locator, type Page } from '@playwright/test';
import '../../src/debug-types';
import type { DebugState } from '../../src/debug-types';
import { fixture } from './fixtures';

export type ClipData = DebugState['edit']['tracks'][number]['clips'][number];

export const state = (page: Page) => page.evaluate(() => window.__editor.state());
export const lanes = (page: Page, kind: string) => page.locator(`[data-testid=track-lane][data-kind=${kind}]`);
export const tile = (page: Page, name: string) => page.locator(`[data-testid=media-item][title="${name}"]`);
export const clipEl = (page: Page, id: string) => page.locator(`[data-testid=clip][data-clip-id="${id}"]`);

export async function allClips(page: Page): Promise<ClipData[]> {
  return (await state(page)).edit.tracks.flatMap((t) => t.clips);
}

export async function setup(page: Page, files: string[]): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => typeof window.__editor?.preview === 'function');
  if (!files.length) return;
  await page.getByTestId('import-input').setInputFiles(files.map(fixture));
  await expect(page.locator('[data-testid=media-item][data-status=ready]')).toHaveCount(files.length, { timeout: 30_000 });
}

export async function addViaPlus(page: Page, name: string): Promise<string> {
  const before = new Set((await allClips(page)).map((c) => c.id));
  await tile(page, name).getByTestId('add-to-timeline').click();
  const added = (await allClips(page)).find((c) => !before.has(c.id));
  expect(added, `${name} 추가`).toBeTruthy();
  return added!.id;
}

export async function drag(page: Page, target: Locator, dx: number, dy = 0): Promise<void> {
  const b = (await target.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

/** 눈금을 눌러 플레이헤드를 frame으로 (기본 줌 2px/프레임, 스크롤 0 기준) */
export async function seekRuler(page: Page, frame: number): Promise<void> {
  const ppf = (await state(page)).ui.pxPerFrame;
  await page.getByTestId('ruler').click({ position: { x: frame * ppf, y: 10 } });
  expect((await state(page)).ui.playhead).toBe(frame);
}

/** 미리보기가 frame을 모든 소스가 준비된 상태로 그릴 때까지 기다린다 */
export async function waitRendered(page: Page, frame: number): Promise<void> {
  await page.waitForFunction((f) => {
    const p = window.__editor.preview();
    return !!p && p.renderedFrame === f && p.ready;
  }, frame);
}

export const pixel = (page: Page, fx = 0.5, fy = 0.5) => page.evaluate(([x, y]) => window.__editor.previewPixel(x, y), [fx, fy]);

/** [r,g,b]가 어떤 기본색인지 */
export function colorName([r, g, b]: number[]): string {
  const hi = (v: number) => v > 170;
  const lo = (v: number) => v < 90;
  if (r < 20 && g < 20 && b < 20) return '검정';
  if (hi(r) && lo(g) && lo(b)) return '빨강';
  if (lo(r) && hi(g) && lo(b)) return '초록';
  if (lo(r) && lo(g) && hi(b)) return '파랑';
  if (hi(r) && hi(g) && lo(b)) return '노랑';
  if (lo(r) && hi(g) && hi(b)) return '청록';
  return `기타(${r},${g},${b})`;
}
