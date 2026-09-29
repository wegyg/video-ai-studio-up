/**
 * 태스크 5: 실시간 미리보기 — 스크럽 프레임 정확도, 편집 즉시 반영, 합성 순서, 재생, 소리/동기화.
 * color-steps.mp4: 0~1초 빨강, 1~2초 초록, 2~3초 파랑, 3~4초 노랑 (30fps, 440Hz 소리)
 */
import { expect, test } from '@playwright/test';
import {
  addViaPlus,
  clipEl,
  colorName,
  drag,
  lanes,
  pixel,
  seekRuler,
  setup,
  state,
  tile,
  waitRendered,
} from './helpers';

test('스크럽: 정지 상태에서 플레이헤드를 옮기면 그 프레임이 정확히 보인다 (R6.3)', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4');
  const cases: [number, string][] = [
    [15, '빨강'],
    [45, '초록'],
    [59, '초록'],
    [89, '파랑'],
    [119, '노랑'],
    [30, '초록'],
    [29, '빨강'],
  ];
  for (const [f, color] of cases) {
    await seekRuler(page, f);
    await waitRendered(page, f);
    expect(colorName(await pixel(page)), `프레임 ${f}`).toBe(color);
  }
  // ←/→ 1프레임 이동: 59 → 60은 초록 → 파랑 경계
  await seekRuler(page, 59);
  await page.keyboard.press('ArrowRight');
  await waitRendered(page, 60);
  expect(colorName(await pixel(page))).toBe('파랑');
  await page.keyboard.press('ArrowLeft');
  await waitRendered(page, 59);
  expect(colorName(await pixel(page))).toBe('초록');
});

test('편집이 바로 반영된다: 분할한 조각은 원본의 해당 지점부터, 빈 곳은 검정, 삭제하면 사라짐 (R6.1)', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4');
  await seekRuler(page, 60);
  await page.keyboard.press('KeyS');
  const [left, right] = (await state(page)).edit.tracks[2].clips;
  await drag(page, clipEl(page, right.id), 120); // 오른쪽 조각을 60 → 120
  expect((await state(page)).edit.tracks[2].clips.map((c) => [c.start, c.inPoint])).toEqual([
    [0, 0],
    [120, 60],
  ]);
  for (const [f, color] of [
    [90, '검정'],
    [120, '파랑'], // 원본 60프레임(2초)
    [150, '노랑'], // 원본 90프레임(3초)
    [59, '초록'],
  ] as [number, string][]) {
    await seekRuler(page, f);
    await waitRendered(page, f);
    expect(colorName(await pixel(page)), `프레임 ${f}`).toBe(color);
  }
  // 정지 화면에서 삭제 → 다음 그리기에 반영
  await clipEl(page, left.id).click();
  await page.keyboard.press('Delete');
  await waitRendered(page, 59);
  expect(colorName(await pixel(page))).toBe('검정');
  await page.keyboard.press('Control+z');
  await waitRendered(page, 59);
  expect(colorName(await pixel(page))).toBe('초록');
});

test('합성: 위 영상 트랙이 앞에 보이고, 비율을 바꾸면 맞춤으로 다시 그린다 (R5.8, R3.2)', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'image.png']);
  await addViaPlus(page, 'color-steps.mp4'); // 메인(영상 1)
  await tile(page, 'image.png').dragTo(lanes(page, 'video').first(), { targetPosition: { x: 4, y: 30 } }); // 영상 2, 0부터
  await seekRuler(page, 10);
  await waitRendered(page, 10);
  // 9:16 캔버스에 400×400 이미지는 가운데 1080×1080 → 가운데는 이미지(청록), 위쪽 10%는 영상(빨강)
  expect(colorName(await pixel(page))).toBe('청록');
  expect(colorName(await pixel(page, 0.5, 0.1))).toBe('빨강');
  await page.screenshot({ path: test.info().outputPath('preview-9x16.png') });

  await page.getByRole('radio', { name: '가로 16:9' }).click();
  await waitRendered(page, 10);
  // 16:9 캔버스: 세로 영상은 좌우가 비고(검정), 이미지는 가운데 1080×1080
  expect(colorName(await pixel(page, 0.1, 0.5))).toBe('검정');
  expect(colorName(await pixel(page, 0.5, 0.5))).toBe('청록');
  const c = await page.getByTestId('preview-canvas').evaluate((el: HTMLCanvasElement) => el.width / el.height);
  expect(c).toBeCloseTo(16 / 9, 1);
});

test('재생: 시간이 흐르고 화면을 자주 그리며, 끝에서 멈춘다', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4');
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  const s = (await page.evaluate(() => window.__editor.preview()))!;
  test.info().annotations.push({ type: 'preview', description: JSON.stringify(s) });
  expect(s.playing).toBe(true);
  expect(s.renderedFrame).toBeGreaterThan(25);
  expect(s.drawFps).toBeGreaterThanOrEqual(50); // 목표 60fps
  expect(s.maxGapMs).toBeLessThan(100);
  await expect(page.getByTestId('time-current')).not.toHaveText('00:00.00');
  // 4초짜리이므로 끝에서 스스로 멈춘다
  await expect.poll(async () => (await state(page)).ui.playing, { timeout: 8000 }).toBe(false);
  expect((await state(page)).ui.playhead).toBe(120);
  await expect(page.getByTestId('time-current')).toHaveText('00:04.00');
  // 끝에서 다시 재생하면 처음부터
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).ui.playhead, { timeout: 3000 }).toBeLessThan(60);
  await page.keyboard.press('Space');
});

test('재생이 클립 경계(분할 지점, 빈 구간 뒤 다음 클립)를 끊김 없이 넘어간다', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'pattern.mov']);
  const a = await addViaPlus(page, 'color-steps.mp4'); // 0~120
  await seekRuler(page, 60);
  await page.keyboard.press('KeyS'); // 0~60 | 60~120
  const b = await addViaPlus(page, 'pattern.mov'); // 플레이헤드(60) 근처 빈 곳 → 120~210
  await drag(page, clipEl(page, b), 30); // 135~225 (120~135는 빈 구간)
  const main = (await state(page)).edit.tracks[2].clips.map((c) => c.start);
  expect(main).toEqual([0, 60, 135]);
  expect(a).toBeTruthy();

  await seekRuler(page, 40);
  await page.keyboard.press('Space');
  // 분할 지점(60)과 빈 구간 뒤 새 클립 시작(135)을 지난 뒤
  await expect.poll(async () => (await state(page)).ui.playhead, { timeout: 8000 }).toBeGreaterThan(165);
  const s = (await page.evaluate(() => window.__editor.preview()))!;
  test.info().annotations.push({ type: 'cut', description: JSON.stringify(s) });
  expect(s.maxGapMs).toBeLessThan(100);
  expect(s.maxDrift).toBeLessThan(2 / 30);
  expect(s.ready).toBe(true);
  await page.keyboard.press('Space');
});

test('소리: 재생 중 출력이 있고, 영상·소리 차이는 2프레임 이내, 트랙을 음소거하면 조용해진다 (R6.5)', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4');
  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);
  const s = (await page.evaluate(() => window.__editor.preview()))!;
  test.info().annotations.push({ type: 'audio', description: JSON.stringify(s) });
  expect(s.audioState).toBe('running');
  expect(s.level).toBeGreaterThan(0.05);
  expect(s.maxDrift).toBeLessThan(2 / 30);
  // 영상 1 트랙 음소거 (음소거 버튼: 영상 2, 영상 1, 오디오 1 순서)
  await page.getByRole('button', { name: '음소거', exact: true }).nth(1).click();
  await expect.poll(async () => (await page.evaluate(() => window.__editor.preview()))!.level, { timeout: 2000 }).toBeLessThan(0.005);
  await page.keyboard.press('Space');
});
