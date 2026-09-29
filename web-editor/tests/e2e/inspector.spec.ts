/**
 * 태스크 6: 미리보기 직접 조작 + 우측 속성 패널.
 * image.png = 400×400 청록 → 9:16 캔버스(1080×1920)에서 가운데 1080×1080을 채운다.
 */
import { expect, test, type Page } from '@playwright/test';
import { addViaPlus, clipEl, colorName, pixel, seekRuler, setup, state, waitRendered } from './helpers';

const box = (page: Page) => page.evaluate(() => window.__editor.clipBox());
const firstClip = async (page: Page) => (await state(page)).edit.tracks[2].clips[0];
const transform = async (page: Page) => (await firstClip(page)).transform!;

/** 프로젝트 px ↔ 화면 px 배율과 미리보기 상자 위치 */
async function frameInfo(page: Page) {
  const r = (await page.getByTestId('preview-frame').boundingBox())!;
  const W = 1080;
  return { ...r, s: r.width / W };
}

/** 미리보기 상자 가운데(= 클립 가운데)의 화면 좌표 */
async function boxCenterScreen(page: Page) {
  const f = await frameInfo(page);
  const b = (await box(page))!;
  return { x: f.x + b.cx * f.s, y: f.y + b.cy * f.s, f, b };
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number, opts: { shift?: boolean } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
}

test.beforeEach(async ({ page }) => {
  await setup(page, ['image.png', 'color-steps.mp4']);
});

test('클립을 넣으면 속성 패널에 값이 표시되고, 미리보기에 선택 상자와 핸들이 보인다', async ({ page }) => {
  await addViaPlus(page, 'image.png');
  await expect(page.getByTestId('prop-kind')).toHaveText('이미지 클립');
  await expect(page.getByTestId('selection-box')).toBeVisible();
  for (const h of ['tl', 'tr', 'br', 'bl', 'rot']) await expect(page.getByTestId(`handle-${h}`)).toBeVisible();
  await expect(page.getByTestId('prop-x')).toHaveValue('0');
  await expect(page.getByTestId('prop-scale')).toHaveValue('100');
  await expect(page.getByTestId('prop-rotation')).toHaveValue('0');
  // 이미지에는 소리가 없으므로 소리 항목은 잠겨 있다
  await expect(page.getByTestId('prop-volume')).toBeDisabled();
  await expect(page.getByTestId('prop-speed')).toHaveText('1배');
  // 상자가 실제 그림 크기(1080×1080, 가운데)와 같다
  expect(await box(page)).toEqual({ cx: 540, cy: 960, w: 1080, h: 1080, rotation: 0 });
  await page.screenshot({ path: test.info().outputPath('inspector.png') });
});

test('미리보기 클릭으로 선택/해제 (회전을 고려한 판정)', async ({ page }) => {
  const img = await addViaPlus(page, 'image.png');
  await waitRendered(page, 0);
  const f = await frameInfo(page);
  // 빈 곳(위쪽, 그림 밖) 클릭 → 선택 해제
  await page.mouse.click(f.x + f.width / 2, f.y + 10);
  expect((await state(page)).ui.selectedClipId).toBeNull();
  await expect(page.getByTestId('selection-box')).toBeHidden();
  // 그림 안쪽 클릭 → 다시 선택
  await page.mouse.click(f.x + f.width / 2, f.y + f.height / 2);
  expect((await state(page)).ui.selectedClipId).toBe(img);

  // 45° 회전 후: 회전한 사각형 밖이 된 모서리를 클릭하면 선택이 풀린다
  await page.getByTestId('prop-rotation').fill('45');
  await page.getByTestId('prop-rotation').press('Enter');
  await expect.poll(async () => (await transform(page)).rotation).toBe(45);
  const b = (await box(page))!;
  const corner = { x: f.x + (b.cx - b.w / 2 + 12) * f.s, y: f.y + (b.cy - b.h / 2 + 12) * f.s };
  await page.mouse.click(corner.x, corner.y);
  expect((await state(page)).ui.selectedClipId).toBeNull();
});

test('안쪽을 끌어 이동: 기록 1개, 미리보기 픽셀도 바뀌고, Ctrl+Z로 복구 (R6.4, R9.3)', async ({ page }) => {
  await addViaPlus(page, 'image.png');
  await waitRendered(page, 0);
  expect(colorName(await pixel(page))).toBe('청록');
  const past0 = (await state(page)).history.past;
  const c = await boxCenterScreen(page);

  await dragBy(page, c, 200, -100);
  const t = await transform(page);
  expect(t.x).toBeCloseTo(200 / c.f.s, -1); // 화면 200px → 프로젝트 좌표
  expect(t.y).toBeCloseTo(-100 / c.f.s, -1);
  expect((await state(page)).history.past).toBe(past0 + 1);
  await expect(page.getByTestId('prop-x')).toHaveValue(String(Math.round(t.x))); // 패널에도 반영
  await waitRendered(page, 0);
  expect(colorName(await pixel(page))).toBe('검정'); // 그림이 가운데에서 비켜남

  await page.keyboard.press('Control+z');
  expect(await transform(page)).toMatchObject({ x: 0, y: 0 });
  await waitRendered(page, 0);
  expect(colorName(await pixel(page))).toBe('청록');
});

test('모서리 핸들로 크기 조절 (비율 유지) + Esc로 취소', async ({ page }) => {
  await addViaPlus(page, 'image.png');
  await waitRendered(page, 0);
  const b0 = (await box(page))!;
  const handle = page.getByTestId('handle-br');
  const hb = (await handle.boundingBox())!;
  const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };

  // 가운데에서 멀어지게 끌면 커진다
  await dragBy(page, from, 60, 60);
  const t1 = await transform(page);
  expect(t1.scale).toBeGreaterThan(1.1);
  const b1 = (await box(page))!;
  expect(b1.w / b1.h).toBeCloseTo(b0.w / b0.h, 3); // 비율 유지
  expect(b1.w).toBeCloseTo(1080 * t1.scale, 0);
  // 패널에는 소수 둘째 자리까지 보여 준다
  expect(Number(await page.getByTestId('prop-scale').inputValue())).toBeCloseTo(t1.scale * 100, 1);

  // Esc로 취소하면 값이 그대로 남고 기록도 늘지 않는다
  const past1 = (await state(page)).history.past;
  const hb2 = (await page.getByTestId('handle-br').boundingBox())!;
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb2.x + 120, hb2.y + 120, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await transform(page)).scale).toBeCloseTo(t1.scale, 3);
  expect((await state(page)).history.past).toBe(past1);
});

test('회전 핸들: 15° 자석, Shift로 자유 회전, 미리보기 픽셀 확인', async ({ page }) => {
  await addViaPlus(page, 'color-steps.mp4'); // 1080×1920 꽉 채움
  await seekRuler(page, 15);
  await waitRendered(page, 15);
  expect(colorName(await pixel(page, 0.5, 0.1))).toBe('빨강');

  /** 회전 핸들을 잡고 가운데 기준으로 delta°만큼 돌린다 (핸들이 어디 붙어 있든 상관없게 상대 각도로 계산) */
  async function rotateBy(deg: number, opts: { shift?: boolean } = {}) {
    const c = await boxCenterScreen(page);
    const hb = (await page.getByTestId('handle-rot').boundingBox())!;
    const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    const r = Math.hypot(from.x - c.x, from.y - c.y);
    const a0 = (Math.atan2(from.x - c.x, -(from.y - c.y)) * 180) / Math.PI; // 위쪽 0°, 시계 방향 +
    const a1 = ((a0 + deg) * Math.PI) / 180;
    const to = { x: c.x + r * Math.sin(a1), y: c.y - r * Math.cos(a1) };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    if (opts.shift) await page.keyboard.down('Shift');
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    if (opts.shift) await page.keyboard.up('Shift');
  }

  // 13° 돌리면 15°에 붙는다
  await rotateBy(13);
  expect((await transform(page)).rotation).toBe(15);

  // Shift를 누르고 돌리면 붙지 않는다 (15 → 약 40)
  await rotateBy(25, { shift: true });
  const rot = (await transform(page)).rotation;
  expect(Math.abs(rot - 40)).toBeLessThan(2.5);
  expect(rot % 15).not.toBe(0);

  // 90°로 돌리면 위쪽 10% 지점은 영상 밖(검정)이 된다
  await page.getByTestId('prop-rotation').fill('90');
  await page.getByTestId('prop-rotation').press('Enter');
  await waitRendered(page, 15);
  expect(colorName(await pixel(page, 0.5, 0.1))).toBe('검정');
  expect(colorName(await pixel(page))).toBe('빨강'); // 가운데는 여전히 영상
});

test('속성 패널: 투명도·초기화, 영상 클립의 볼륨·페이드', async ({ page }) => {
  await addViaPlus(page, 'color-steps.mp4');
  await seekRuler(page, 15);
  await waitRendered(page, 15);

  // 투명도 0 → 검정
  await page.getByTestId('prop-opacity').fill('0');
  await expect.poll(async () => (await transform(page)).opacity).toBe(0);
  await waitRendered(page, 15);
  expect(colorName(await pixel(page))).toBe('검정');

  // 위치·크기를 바꾼 뒤 초기화
  await page.getByTestId('prop-x').fill('300');
  await page.getByTestId('prop-x').press('Enter');
  await page.getByTestId('prop-scale').fill('50');
  await page.getByTestId('prop-scale').press('Enter');
  await expect.poll(async () => (await transform(page)).scale).toBe(0.5);
  await page.getByTestId('reset-transform').click();
  expect(await transform(page)).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
  await waitRendered(page, 15);
  expect(colorName(await pixel(page))).toBe('빨강');

  // 소리가 있는 영상: 볼륨과 페이드를 고칠 수 있다
  await expect(page.getByTestId('prop-volume')).toBeEnabled();
  await page.getByTestId('prop-volume').fill('150');
  await page.getByTestId('prop-fade-in').fill('0.5');
  await page.getByTestId('prop-fade-in').press('Enter');
  const c = await firstClip(page);
  expect(c.volume).toBeCloseTo(1.5, 2);
  expect(c.fadeIn).toBe(15); // 0.5초 = 15프레임
});

test('선택한 클립이 현재 시간에 없으면 안내와 이동 버튼이 나온다', async ({ page }) => {
  const id = await addViaPlus(page, 'image.png'); // 0~150
  await seekRuler(page, 200);
  await expect(page.getByTestId('selection-box')).toBeHidden();
  await expect(page.getByTestId('inspector')).toContainText('현재 시간에 없습니다');
  await page.getByTestId('goto-clip').click();
  expect((await state(page)).ui.playhead).toBe(0);
  await expect(page.getByTestId('selection-box')).toBeVisible();
  expect((await state(page)).ui.selectedClipId).toBe(id);
  // 오디오 클립은 화면 배치가 없다
  await clipEl(page, id).click();
  await expect(page.getByTestId('prop-x')).toBeVisible();
});
