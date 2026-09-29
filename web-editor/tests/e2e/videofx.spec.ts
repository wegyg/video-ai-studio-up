/**
 * 2단계 7번: 영상 효과 6종 (R15) — 흔들림, 번쩍임, 줌 펄스, 흑백, 레트로, 블러. 짧은 클립, 작은 해상도(360×640) 비교.
 */
import { expect, test, type Page } from '@playwright/test';
import { meanDiff, previewGrid, previewVsExport } from './compare';
import { addViaPlus, clipEl, drag, pixel, seekRuler, setup, state, tile, waitRendered } from './helpers';

const fx = (page: Page, kind: string) => page.locator(`[data-testid=video-fx][data-kind="${kind}"]`);
const clipById = async (page: Page, id: string) => (await state(page)).edit.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
const box = (page: Page, id: string) => page.evaluate((i) => window.__editor.clipBox(i), id);
const px = (page: Page, x: number, y: number) => pixel(page, x / 1080, y / 1920);
const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

async function show(page: Page, frame: number) {
  await seekRuler(page, frame);
  await waitRendered(page, frame);
}
/** 누른 뒤 자동으로 잠깐 재생해 보여 주는 것이 끝날 때까지 */
async function idle(page: Page) {
  await expect.poll(async () => (await state(page)).ui.playing, { timeout: 10_000 }).toBe(false);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
});

test('흑백·레트로·블러: 누르면 바로 바뀌고(재생하지 않음), 다시 누르면 원래대로 · 강도 · 새로고침', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'pattern.mov']);
  const v = await addViaPlus(page, 'color-steps.mp4'); // 0~120, 0-29 빨강
  const p = await addViaPlus(page, 'pattern.mov'); // 120~210
  await clipEl(page, v).click();
  await page.getByRole('tab', { name: '효과' }).click();
  await expect(page.getByTestId('video-fx')).toHaveCount(6);
  await show(page, 15);
  const red = await pixel(page);

  await fx(page, 'mono').click();
  expect((await state(page)).ui.playing).toBe(false);
  await waitRendered(page, 15);
  const gray = await pixel(page);
  expect(Math.max(...gray) - Math.min(...gray), `흑백 ${gray}`).toBeLessThan(6);
  await page.getByTestId('fx-intensity-mono').fill('50');
  await waitRendered(page, 15);
  const half = await pixel(page);
  expect(half[0] - half[1]).toBeGreaterThan(40); // 반만 빠진 색
  expect(half[0] - half[1]).toBeLessThan(red[0] - red[1] - 40);
  await fx(page, 'mono').click();
  await waitRendered(page, 15);
  expect(maxDiff(await pixel(page), red)).toBeLessThanOrEqual(2);

  await fx(page, 'retro').click();
  await waitRendered(page, 15);
  const retro = await pixel(page);
  expect(maxDiff(retro, red), `레트로 ${retro}`).toBeGreaterThan(30);
  expect(Math.max(...retro) - Math.min(...retro)).toBeGreaterThan(20); // 흑백이 아니라 누런 색
  await fx(page, 'retro').click();

  // 블러: 날카로운 무늬 영상에서 칸 사이 변화가 줄어든다
  await clipEl(page, p).click();
  await show(page, 150);
  // 촘촘한 칸(프로젝트 10px)으로 잰다 — 굵은 칸은 칸 안에서 평균이 되어 블러 차이가 보이지 않는다
  const sharp = await previewGrid(page, 108, 192);
  await fx(page, 'blur').click();
  await waitRendered(page, 150);
  const soft = await previewGrid(page, 108, 192);
  const contrast = (g: number[]) => {
    let s = 0;
    for (let j = 72; j < 120; j++) for (let i = 1; i < 108; i++) for (let c = 0; c < 3; c++) s += Math.abs(g[(j * 108 + i) * 3 + c] - g[(j * 108 + i - 1) * 3 + c]);
    return s;
  };
  expect(contrast(soft)).toBeLessThan(contrast(sharp) * 0.8);

  await page.evaluate(() => window.__editor.saveNow());
  await page.reload();
  await page.waitForFunction(() => typeof window.__editor?.state === 'function');
  await expect.poll(async () => (await clipById(page, p))?.effects).toEqual([{ kind: 'blur', intensity: 60 }]);
  expect((await clipById(page, v)).effects).toBeUndefined();
});

test('번쩍임·줌 펄스·흔들림: 켜면 잠깐 재생해 보여 주고, 시간에 따라 화면이 바뀐다', async ({ page }) => {
  await setup(page, ['image.png', 'logo.png']);
  const img = await addViaPlus(page, 'image.png'); // 0~150, 청록
  const logo = await addViaPlus(page, 'logo.png'); // 150~300
  await page.getByRole('tab', { name: '효과' }).click();
  await clipEl(page, img).click();
  await seekRuler(page, 0);
  await fx(page, 'flash').click();
  await expect.poll(async () => (await state(page)).ui.playing).toBe(true); // 켜자마자 보여 준다
  await idle(page);
  expect((await state(page)).ui.playhead).toBe(0); // 보여 준 뒤 제자리
  await show(page, 0);
  expect((await pixel(page))[0], '시작하자마자 번쩍').toBeGreaterThan(80);
  await show(page, 10);
  expect((await pixel(page))[0], '0.33초에는 원래 색').toBeLessThan(10);
  await fx(page, 'flash').click();

  // 줌 펄스: 투명 PNG 로고(가운데 자홍 정사각형)가 0.13초쯤 커진다
  await clipEl(page, logo).click();
  await seekRuler(page, 150);
  await fx(page, 'zoom-pulse').click();
  await idle(page);
  await show(page, 150);
  const b = (await box(page, logo))!;
  const probe = () => px(page, b.cx + b.w * 0.26, b.cy); // 정사각형 가장자리(0.25) 바로 바깥
  expect((await probe())[2], '0초: 바깥은 비어 있다').toBeLessThan(40);
  await show(page, 154);
  expect((await probe())[2], '0.13초: 커져서 자홍').toBeGreaterThan(200);
  await fx(page, 'zoom-pulse').click();

  // 흔들림: 멈춘 그림인데도 프레임마다 위치가 다르다 (끄면 같다)
  await show(page, 153);
  const s0 = await previewGrid(page, 27, 48);
  await show(page, 158);
  expect(meanDiff(s0, await previewGrid(page, 27, 48))).toBeLessThan(0.3);
  await fx(page, 'shake').click();
  await idle(page);
  await show(page, 153);
  const a1 = await previewGrid(page, 27, 48);
  await show(page, 158);
  expect(meanDiff(a1, await previewGrid(page, 27, 48))).toBeGreaterThan(1);
});

test('미리보기 = 내보내기: 영상(레트로·블러) + 로고(흔들림·번쩍임·줌 펄스)의 프레임 3곳 픽셀이 같다', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'logo.png']);
  const v = await addViaPlus(page, 'color-steps.mp4'); // 메인 0~120
  await tile(page, 'logo.png').getByTestId('add-overlay').click(); // 위 트랙 0~150
  const logo = (await state(page)).ui.selectedClipId!;
  await page.getByRole('tab', { name: '효과' }).click();
  for (const k of ['shake', 'flash', 'zoom-pulse']) {
    await fx(page, k).click();
    await idle(page);
  }
  await clipEl(page, v).click();
  await fx(page, 'retro').click();
  await fx(page, 'blur').click();
  expect((await clipById(page, logo)).effects?.map((e) => e.kind)).toEqual(['shake', 'flash', 'zoom-pulse']);
  // 내보내기를 2초로 줄인다 (끝 핸들을 끌어 두 클립 모두 0~60) — 몇 프레임만 비교하면 된다
  await drag(page, clipEl(page, logo).getByTestId('trim-end'), -180);
  await drag(page, clipEl(page, v).getByTestId('trim-end'), -120);
  expect([(await clipById(page, logo)).duration, (await clipById(page, v)).duration]).toEqual([60, 60]);
  const frames = [4, 20, 50];
  const diffs = await previewVsExport(page, frames, 'VIDEOFX_EXPORT');
  for (let i = 0; i < frames.length; i++) expect(diffs[i], `프레임 ${frames[i]}`).toBeLessThanOrEqual(3);
});
