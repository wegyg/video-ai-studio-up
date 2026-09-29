/**
 * 2단계 5번: 오버레이 (R18) — 투명 PNG 로고, 도형, 화면 속 화면(PIP). 짧은 클립, 작은 해상도(360×640) 비교.
 */
import { expect, test, type Page } from '@playwright/test';
import { previewVsExport } from './compare';
import { addViaPlus, colorName, pixel, seekRuler, setup, state, tile, waitRendered } from './helpers';

const box = (page: Page, id: string) => page.evaluate((i) => window.__editor.clipBox(i), id);
/** 프로젝트 좌표(1080×1920) → 미리보기 비율 위치의 픽셀 */
const px = (page: Page, x: number, y: number) => pixel(page, x / 1080, y / 1920);
const near = (a: number[], b: number[], tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const clipById = async (page: Page, id: string) => (await state(page)).edit.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
const trackOf = async (page: Page, id: string) => (await state(page)).edit.tracks.findIndex((t) => t.clips.some((c) => c.id === id));

async function overlay(page: Page, name: string) {
  const before = new Set((await state(page)).edit.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  await tile(page, name).getByTestId('add-overlay').click();
  const added = (await state(page)).edit.tracks.flatMap((t) => t.clips).find((c) => !before.has(c.id));
  expect(added, `${name} 위에 얹기`).toBeTruthy();
  return added!.id;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
});

test('투명 PNG 로고: 위 트랙 오른쪽 위에 작게 들어가고, 투명한 곳은 아래 영상이 보인다', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'logo.png']);
  await addViaPlus(page, 'color-steps.mp4'); // 메인 트랙 0~120, 처음 1초 빨강
  const logo = await overlay(page, 'logo.png');
  expect(await trackOf(page, logo)).toBe(1); // 위 영상 트랙 (메인 위)
  const c = await clipById(page, logo);
  expect(c.transform?.scale).toBe(0.3);
  await seekRuler(page, 10);
  await waitRendered(page, 10);
  const b = (await box(page, logo))!;
  expect(b.cx).toBeGreaterThan(540); // 오른쪽
  expect(b.cy).toBeLessThan(960 - 400); // 위쪽
  expect(b.cy - b.h / 2).toBeGreaterThanOrEqual(1920 * 0.08 - 1); // 쇼츠 위쪽 UI 아래
  // 가운데(불투명 자홍) / 가장자리(투명 → 아래 빨강)
  expect(near(await px(page, b.cx, b.cy), [255, 0, 255]), `${await px(page, b.cx, b.cy)}`).toBe(true);
  expect(colorName(await px(page, b.cx - b.w * 0.4, b.cy - b.h * 0.4))).toBe('빨강');
});

test('도형: 누르면 위 트랙에 들어가 바로 그려지고, 색·모양·크기를 바꾸면 바로 반영된다 · 새로고침해도 남는다', async ({ page }) => {
  await setup(page, []);
  await page.getByRole('tab', { name: '요소' }).click();
  await page.locator('[data-testid=add-shape][data-shape=rect]').click();
  const id = (await state(page)).ui.selectedClipId!;
  expect((await clipById(page, id)).type).toBe('shape');
  expect(await trackOf(page, id)).toBe(1);
  await seekRuler(page, 30);
  await waitRendered(page, 30);
  expect(near(await pixel(page), [34, 211, 238], 3)).toBe(true); // 기본 청록 #22d3ee
  let b = (await box(page, id))!;
  expect([b.w, b.h]).toEqual([600, 400]);
  expect(near(await px(page, b.cx - b.w * 0.45, b.cy - b.h * 0.45), [34, 211, 238], 3)).toBe(true); // 사각형 모서리도 채움

  await page.getByTestId('shape-fill').fill('#ff0000');
  await waitRendered(page, 30);
  expect(colorName(await pixel(page))).toBe('빨강');
  await page.getByTestId('shape-kind').selectOption('circle');
  await waitRendered(page, 30);
  expect(colorName(await px(page, b.cx - b.w * 0.45, b.cy - b.h * 0.45))).toBe('검정'); // 원: 상자 모서리는 비어 있다
  expect(colorName(await pixel(page))).toBe('빨강');
  await page.getByTestId('shape-width').fill('200');
  await page.getByTestId('shape-width').press('Enter');
  b = (await box(page, id))!;
  expect(b.w).toBe(200);
  await page.getByTestId('shape-kind').selectOption('triangle');
  await waitRendered(page, 30);
  expect(colorName(await px(page, b.cx, b.cy + b.h * 0.4))).toBe('빨강'); // 아래 가운데
  expect(colorName(await px(page, b.cx - b.w * 0.4, b.cy - b.h * 0.4))).toBe('검정'); // 위 모서리

  await page.evaluate(() => window.__editor.saveNow());
  await page.reload();
  await page.waitForFunction(() => typeof window.__editor?.state === 'function');
  await expect.poll(async () => (await clipById(page, id))?.shape).toBe('triangle');
  expect((await clipById(page, id)).fill).toBe('#ff0000');
});

test('화면 속 화면: 영상을 위에 얹으면 오른쪽 위에 작게 보이고, 아래 화면과 함께 재생된다', async ({ page }) => {
  await setup(page, ['image.jpg', 'color-steps.mp4']);
  await addViaPlus(page, 'image.jpg'); // 메인: 주황 0~150
  const pip = await overlay(page, 'color-steps.mp4'); // 위 트랙 0~120
  expect((await clipById(page, pip)).transform?.scale).toBe(0.4);
  await seekRuler(page, 45); // 원본 45 = 초록
  await waitRendered(page, 45);
  const b = (await box(page, pip))!;
  expect(colorName(await px(page, b.cx, b.cy))).toBe('초록');
  expect(near(await px(page, 300, 960), [255, 136, 0])).toBe(true); // 아래 주황 사진 (3:2 → 가운데 1080×720)
  await page.keyboard.press('Space');
  await expect.poll(async () => (await page.evaluate((i) => window.__editor.mediaState(i), pip))?.paused, { timeout: 5000 }).toBe(false);
  await page.keyboard.press('Space');
});

test('미리보기 = 내보내기: 영상 + 투명 PNG 로고 + 테두리 있는 도형의 프레임 3곳 픽셀이 같다', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'logo.png']);
  await addViaPlus(page, 'color-steps.mp4'); // 메인 0~120 (빨강·초록·파랑·노랑)
  await overlay(page, 'logo.png'); // 위 트랙 0~150
  await page.getByRole('button', { name: '영상 트랙 추가' }).click(); // 도형은 그 위의 새 트랙에
  await seekRuler(page, 0);
  await page.getByRole('tab', { name: '요소' }).click();
  await page.locator('[data-testid=add-shape][data-shape=circle]').click();
  const shape = (await state(page)).ui.selectedClipId!;
  expect(await trackOf(page, shape)).toBe(1);
  await page.getByTestId('prop-y').fill('500');
  await page.getByTestId('prop-y').press('Enter');
  await page.getByTestId('shape-stroke-width').fill('20');
  const frames = [10, 45, 80];
  const diffs = await previewVsExport(page, frames, 'OVERLAY_EXPORT');
  for (let i = 0; i < frames.length; i++) expect(diffs[i], `프레임 ${frames[i]}`).toBeLessThanOrEqual(3);
});
