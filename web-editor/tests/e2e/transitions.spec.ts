/**
 * 2단계 2번: 트랜지션 11종 (R14) — 클립 경계에 넣기(누르기·끌어 놓기), 길이 조절, 이동·삭제·실행 취소, 저장.
 * 규칙: 트랜지션이 걸린 같은 프레임을 미리보기와 내보낸 MP4 두 곳에서 뽑아 픽셀을 비교한다.
 */
import { expect, test, type Page } from '@playwright/test';
import { TRANSITION_KINDS } from '../../src/model/transitions';
import { meanDiff, previewGrid, previewVsExport } from './compare';
import { addViaPlus, clipEl, drag, pixel, seekRuler, setup, state, waitRendered } from './helpers';

const mainTrack = async (page: Page) => (await state(page)).edit.tracks[2];
const clipById = async (page: Page, id: string) => (await mainTrack(page)).clips.find((c) => c.id === id);
const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const tileOf = (page: Page, kind: string) => page.locator(`[data-testid=transition-preset][data-kind="${kind}"]`);

/** 넣은 뒤 자동으로 한 번 재생해 보여 주는 것이 끝나고, 플레이헤드가 frame에서 그려질 때까지 */
async function waitIdle(page: Page, frame: number) {
  await expect.poll(async () => (await state(page)).ui.playing, { timeout: 20_000 }).toBe(false);
  await expect.poll(async () => (await state(page)).ui.playhead).toBe(frame);
  await waitRendered(page, frame);
}

async function show(page: Page, frame: number) {
  await seekRuler(page, frame);
  await waitRendered(page, frame);
}

/** 이미지 두 장: 청록 0~150, 주황 150~300 */
async function twoImages(page: Page) {
  await setup(page, ['image.png', 'image.jpg']);
  const a = await addViaPlus(page, 'image.png');
  const b = await addViaPlus(page, 'image.jpg');
  expect((await mainTrack(page)).clips.map((c) => [c.id, c.start, c.duration])).toEqual([
    [a, 0, 150],
    [b, 150, 150],
  ]);
  await page.getByRole('tab', { name: '효과' }).click();
  return { a, b };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
});

test('누르면 바로: 경계에 디졸브가 들어가 한 번 재생되고, 경계 프레임은 두 화면을 반씩 섞는다', async ({ page }) => {
  const { b } = await twoImages(page);
  await show(page, 100);
  const ca = await pixel(page);
  await show(page, 200);
  const cb = await pixel(page);

  await tileOf(page, 'dissolve').click(); // 아무것도 고르지 않았으면 플레이헤드에서 가장 가까운 경계
  await waitIdle(page, 150); // 구간을 재생해 보여 준 뒤 경계로 돌아온다
  const st = await state(page);
  expect((await clipById(page, b))!.transitionIn).toEqual({ kind: 'dissolve', duration: 15 });
  expect(st.ui.selectedTransition).toBe(b);
  await expect(page.locator(`[data-testid=transition][data-to-clip-id="${b}"]`)).toBeVisible();
  await expect(page.getByTestId('transition-props')).toBeVisible();
  await expect(tileOf(page, 'dissolve')).toHaveAttribute('aria-pressed', 'true');

  // 경계 프레임 150 = 구간 143~157의 한가운데 (진행도 0.5)
  const want = ca.map((v, i) => (v + cb[i]) / 2);
  expect(maxDiff(await pixel(page), want), `섞인 색 ${await pixel(page)} / 기대 ${want}`).toBeLessThanOrEqual(4);
  // 구간 밖은 그대로
  await show(page, 142);
  expect(maxDiff(await pixel(page), ca)).toBeLessThanOrEqual(2);
  await show(page, 158);
  expect(maxDiff(await pixel(page), cb)).toBeLessThanOrEqual(2);
});

test('트랜지션 11종: 모두 들어가고, 같은 프레임에서 서로 다른 화면을 만든다', async ({ page }) => {
  await setup(page, ['pattern.mov', 'color-steps.mp4']);
  await addViaPlus(page, 'pattern.mov'); // 0~90 (움직이는 무늬)
  const b = await addViaPlus(page, 'color-steps.mp4'); // 90~210
  expect((await mainTrack(page)).clips.map((c) => c.start)).toEqual([0, 90]);
  await page.getByRole('tab', { name: '효과' }).click();
  await expect(page.getByTestId('transition-preset')).toHaveCount(11);
  await clipEl(page, b).click(); // 고른 클립의 앞 경계에 넣는다

  const F = 87; // 구간 83~97, 진행도 (87-83+0.5)/15 = 0.3
  await show(page, F);
  const plain = await previewGrid(page, 18, 32);
  const grids: [string, number[]][] = [];
  for (const kind of TRANSITION_KINDS) {
    await tileOf(page, kind).click();
    await waitIdle(page, 90);
    expect((await clipById(page, b))!.transitionIn?.kind).toBe(kind);
    await show(page, F);
    grids.push([kind, await previewGrid(page, 18, 32)]);
  }
  for (const [kind, g] of grids) expect(meanDiff(g, plain), `${kind}는 그냥 자른 화면과 다르다`).toBeGreaterThan(2);
  let min = Infinity;
  let pair = '';
  for (let i = 0; i < grids.length; i++) {
    for (let j = i + 1; j < grids.length; j++) {
      const d = meanDiff(grids[i][1], grids[j][1]);
      if (d < min) [min, pair] = [d, `${grids[i][0]}↔${grids[j][0]}`];
    }
  }
  console.log(`TRANSITION_DISTINCT min=${min.toFixed(2)} (${pair})`);
  expect(min, `가장 비슷한 두 종류: ${pair}`).toBeGreaterThan(1);
});

test('여분 사용: 자른 앞 클립은 경계 뒤에서도 원본을 이어서 보여 준다 (멈춘 프레임이 아니다)', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'image.png']);
  await addViaPlus(page, 'color-steps.mp4'); // 0~120: 빨강 0-29, 초록 30-59, 파랑 60-89, 노랑 90-119
  await show(page, 58);
  await page.keyboard.press('KeyS');
  const right = (await mainTrack(page)).clips.find((c) => c.start === 58)!;
  await clipEl(page, right.id).click();
  await page.keyboard.press('Delete');
  const img = await addViaPlus(page, 'image.png'); // 58~208 (청록)
  expect((await mainTrack(page)).clips.map((c) => [c.start, c.duration])).toEqual([
    [0, 58],
    [58, 150],
  ]);
  await show(page, 150);
  const cyan = await pixel(page);

  await page.getByRole('tab', { name: '효과' }).click();
  await clipEl(page, img).click();
  await tileOf(page, 'dissolve').click();
  await waitIdle(page, 58);
  await page.getByTestId('transition-duration').fill('1'); // 1초 = 30프레임 → 구간 43~72
  expect((await clipById(page, img))!.transitionIn).toEqual({ kind: 'dissolve', duration: 30 });

  // 61: 진행도 (61-43+0.5)/30. 앞 화면 = 원본 61번(파랑). 여분을 안 썼다면 57번(초록)에 멈춰 있을 것
  await show(page, 61);
  const p = 18.5 / 30;
  const got = await pixel(page);
  const mix = (c: number[]) => c.map((v, i) => v * (1 - p) + cyan[i] * p);
  expect(maxDiff(got, mix([0, 0, 255])), `${got}`).toBeLessThanOrEqual(8);
  expect(maxDiff(got, mix([0, 255, 0]))).toBeGreaterThan(40);
});

test('길이 조절: 속성 패널에서 바꾸면 구간이 바로 바뀌고, 최대 2초·양쪽 클립 안으로 제한된다', async ({ page }) => {
  const { b } = await twoImages(page);
  await show(page, 60);
  const ca = await pixel(page, 0.5, 0.5);
  await clipEl(page, b).click();
  await tileOf(page, 'wipe').click();
  await waitIdle(page, 150);
  // 0.5초(구간 143~157)일 때 140은 구간 밖 → 앞 화면 그대로
  await show(page, 140);
  expect(maxDiff(await pixel(page, 0.1, 0.5), ca)).toBeLessThanOrEqual(2);

  await page.locator(`[data-testid=transition][data-to-clip-id="${b}"]`).click();
  const slider = page.getByTestId('transition-duration');
  await expect(slider).toHaveAttribute('max', '2');
  await slider.fill('2');
  expect((await clipById(page, b))!.transitionIn?.duration).toBe(60); // 구간 120~179
  // 140: 진행도 (140-120+0.5)/60 ≈ 0.34 → 와이프 경계가 화면 왼쪽 4분의 1쯤. 왼쪽은 새 화면, 오른쪽은 앞 화면
  await show(page, 140);
  expect(maxDiff(await pixel(page, 0.1, 0.5), ca)).toBeGreaterThan(40);
  expect(maxDiff(await pixel(page, 0.9, 0.5), ca)).toBeLessThanOrEqual(2);
  // 타임라인 표시도 2초 너비 (기본 줌 2px/프레임)
  const w = (await page.locator(`[data-testid=transition][data-to-clip-id="${b}"]`).boundingBox())!.width;
  expect(w).toBeGreaterThan(110);
});

test('끌어다 놓기: 타일을 두 클립 경계로 끌면 들어가고, 경계가 아닌 곳에는 놓이지 않는다', async ({ page }) => {
  const { b } = await twoImages(page);
  const trackId = (await mainTrack(page)).id;
  const lane = page.locator(`[data-testid=track-lane][data-track-id="${trackId}"]`);
  const laneBox = (await lane.boundingBox())!;
  const bx = (await clipEl(page, b).boundingBox())!.x - laneBox.x;
  const y = laneBox.height / 2;

  await tileOf(page, 'slide-left').dragTo(lane, { targetPosition: { x: bx - 150, y } }); // 앞 클립 가운데쯤
  expect((await clipById(page, b))!.transitionIn).toBeUndefined();

  await tileOf(page, 'slide-left').dragTo(lane, { targetPosition: { x: bx + 6, y } }); // 경계 바로 옆
  await waitIdle(page, 150);
  expect((await clipById(page, b))!.transitionIn).toEqual({ kind: 'slide-left', duration: 15 });
  await expect(page.getByTestId('cut-target')).toHaveCount(0); // 끌기가 끝나면 놓을 곳 표시도 사라진다
});

test('떼어 놓으면 없어지고 Ctrl+Z로 돌아온다 · 끌다가 제자리로 오면 남는다 · Delete 키로 지운다', async ({ page }) => {
  const { b } = await twoImages(page);
  await clipEl(page, b).click();
  await tileOf(page, 'dissolve').click();
  await waitIdle(page, 150);
  const history0 = (await state(page)).history.past;

  // 끌다가 제자리로: 끄는 동안 떨어져도 끝났을 때 붙어 있으면 그대로
  const box = (await clipEl(page, b).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 5 });
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
  expect((await clipById(page, b))!.start).toBe(150);
  expect((await clipById(page, b))!.transitionIn?.kind).toBe('dissolve');
  expect((await state(page)).history.past).toBe(history0);

  // 떼어 놓으면 경계가 없어지므로 트랜지션도 없어진다 (기록 1개)
  await drag(page, clipEl(page, b), 80);
  expect((await clipById(page, b))!.start).toBe(190);
  expect((await clipById(page, b))!.transitionIn).toBeUndefined();
  await expect(page.getByTestId('transition')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  expect((await clipById(page, b))!.start).toBe(150);
  expect((await clipById(page, b))!.transitionIn?.kind).toBe('dissolve');

  // 타임라인 표시를 눌러 고른 뒤 Delete
  await page.locator(`[data-testid=transition][data-to-clip-id="${b}"]`).click();
  expect((await state(page)).ui.selectedTransition).toBe(b);
  await page.keyboard.press('Delete');
  expect((await clipById(page, b))!.transitionIn).toBeUndefined();
  expect((await mainTrack(page)).clips).toHaveLength(2); // 클립은 그대로
  await page.keyboard.press('Control+z');
  expect((await clipById(page, b))!.transitionIn?.kind).toBe('dissolve');
});

test('트랜지션은 새로고침해도 남는다', async ({ page }) => {
  const { b } = await twoImages(page);
  await tileOf(page, 'glitch').click();
  await waitIdle(page, 150);
  await page.evaluate(() => window.__editor.saveNow());
  await page.reload();
  await page.waitForFunction(() => typeof window.__editor?.state === 'function');
  await expect.poll(async () => (await clipById(page, b))?.transitionIn).toEqual({ kind: 'glitch', duration: 15 });
  await expect(page.locator(`[data-testid=transition][data-to-clip-id="${b}"]`)).toBeVisible();
});

test('미리보기 = 내보내기: 트랜지션 3종(디졸브·슬라이드·글리치)이 걸린 프레임 3곳의 픽셀이 같다', async ({ page }) => {
  await setup(page, ['pattern.mov', 'color-steps.mp4', 'image.png', 'image.jpg']);
  await addViaPlus(page, 'pattern.mov'); // 0~90
  const b = await addViaPlus(page, 'color-steps.mp4'); // 90~210
  const c = await addViaPlus(page, 'image.png'); // 210~360
  const d = await addViaPlus(page, 'image.jpg'); // 360~510
  expect((await mainTrack(page)).clips.map((x) => x.start)).toEqual([0, 90, 210, 360]);
  await page.getByRole('tab', { name: '효과' }).click();

  await clipEl(page, b).click();
  await tileOf(page, 'dissolve').click(); // 구간 83~97
  await waitIdle(page, 90);
  await clipEl(page, c).click();
  await tileOf(page, 'slide-up').click();
  await waitIdle(page, 210);
  await page.getByTestId('transition-duration').fill('1'); // 구간 195~224
  await clipEl(page, d).click();
  await tileOf(page, 'glitch').click(); // 구간 353~367
  await waitIdle(page, 360);

  // 86: 앞 영상(자기 프레임) + 뒤 영상(시작 전이라 첫 프레임에 멈춤), 205: 영상→이미지, 364: 이미지→이미지
  const frames = [86, 205, 364];
  const diffs = await previewVsExport(page, frames, 'TRANSITION_EXPORT');
  test.info().annotations.push({ type: 'transition-export-diff', description: JSON.stringify(diffs) });
  for (let i = 0; i < frames.length; i++) expect(diffs[i], `프레임 ${frames[i]}`).toBeLessThanOrEqual(3);
});
