/**
 * 태스크 8: 오디오 편집 — 볼륨 0~200%, 타임라인 페이드 핸들과 표시, BGM 트랙, 트랙 음소거.
 * 미리보기가 실제로 gainAt 곡선을 적용하는지 GainNode 값으로 확인한다 (R8.4).
 */
import { expect, test, type Page } from '@playwright/test';
import { addViaPlus, clipEl, drag, lanes, seekRuler, setup, state, tile, waitRendered } from './helpers';

/** 프레임 f에서 clip에 걸릴 이론값 (src/model/audio.ts gainAt와 같은 계산) */
function expectedGain(c: { start: number; duration: number; volume: number; fadeIn: number; fadeOut: number }, f: number): number {
  const t = f - c.start;
  if (t < 0 || t > c.duration) return 0;
  let g = c.volume;
  if (c.fadeIn > 0 && t < c.fadeIn) g *= t / c.fadeIn;
  const rest = c.duration - t;
  if (c.fadeOut > 0 && rest < c.fadeOut) g *= rest / c.fadeOut;
  return g;
}

const audioClip = async (page: Page) => (await state(page)).edit.tracks[3].clips[0];
const videoClip = async (page: Page) => (await state(page)).edit.tracks[2].clips[0];
const gain = (page: Page, id: string) => page.evaluate((i) => window.__editor.clipGain(i), id);

test('BGM 트랙: 오디오 파일을 올리고 볼륨을 0~200%로 바꾼다 (R8.1, R8.3)', async ({ page }) => {
  await setup(page, ['audio.mp3']);
  await tile(page, 'audio.mp3').dragTo(lanes(page, 'audio').first(), { targetPosition: { x: 4, y: 20 } });
  const c = await audioClip(page);
  expect(c.type).toBe('audio');
  expect(c.volume).toBe(1);
  await expect(page.getByTestId('prop-kind')).toHaveText('오디오 클립');
  // 오디오 클립에는 화면 배치가 없다
  await expect(page.getByTestId('prop-x')).toHaveCount(0);

  await page.getByTestId('prop-volume').fill('200');
  await expect.poll(async () => (await audioClip(page)).volume).toBe(2);
  await expect(clipEl(page, c.id).getByTestId('clip-volume-badge')).toHaveText('200%');
  await page.getByTestId('prop-volume').fill('0');
  await expect.poll(async () => (await audioClip(page)).volume).toBe(0);
  await expect(clipEl(page, c.id).getByTestId('clip-volume-badge')).toHaveText('0%');
  // 100%로 돌리면 배지는 사라진다
  await page.getByTestId('prop-volume').fill('100');
  await expect(clipEl(page, c.id).getByTestId('clip-volume-badge')).toHaveCount(0);
});

test('타임라인 페이드 핸들: 끌어서 길이를 정하고 구간이 표시된다 (R8.2)', async ({ page }) => {
  await setup(page, ['audio.mp3']);
  await tile(page, 'audio.mp3').dragTo(lanes(page, 'audio').first(), { targetPosition: { x: 4, y: 20 } });
  const c0 = await audioClip(page);
  const el = clipEl(page, c0.id);
  const ppf = (await state(page)).ui.pxPerFrame;

  // 페이드가 0이면 표시 없음
  await expect(el.getByTestId('fade-in-ramp')).toHaveCount(0);
  await expect(el.getByTestId('fade-out-ramp')).toHaveCount(0);

  const past0 = (await state(page)).history.past;
  await drag(page, el.getByTestId('fade-in-handle'), 60); // 60px → 30프레임(1초)
  const afterIn = await audioClip(page);
  expect(afterIn.fadeIn).toBeCloseTo(60 / ppf, 0);
  expect((await state(page)).history.past).toBe(past0 + 1); // 드래그 한 번 = 기록 1개
  await expect(el.getByTestId('fade-in-ramp')).toBeVisible();
  expect((await el.getByTestId('fade-in-ramp').boundingBox())!.width).toBeCloseTo(afterIn.fadeIn! * ppf, 0);
  await expect(page.getByTestId('prop-fade-in')).toHaveValue(String(Math.round((afterIn.fadeIn! / 30) * 100) / 100));

  await drag(page, el.getByTestId('fade-out-handle'), -40); // 왼쪽으로 = 페이드 아웃 늘리기
  const afterOut = await audioClip(page);
  expect(afterOut.fadeOut).toBeCloseTo(40 / ppf, 0);
  await expect(el.getByTestId('fade-out-ramp')).toBeVisible();
  // 페이드 조절이 클립 길이나 위치를 바꾸지 않았다 (트림 핸들과 섞이지 않음)
  expect([afterOut.start, afterOut.duration]).toEqual([c0.start, c0.duration]);

  // 실행 취소로 각각 되돌아간다
  await page.keyboard.press('Control+z');
  expect((await audioClip(page)).fadeOut).toBe(0);
  await page.keyboard.press('Control+z');
  expect((await audioClip(page)).fadeIn).toBe(0);
  await expect(el.getByTestId('fade-in-ramp')).toHaveCount(0);
});

test('페이드는 클립 길이를 넘지 않고, 트림하면 함께 줄어든다', async ({ page }) => {
  await setup(page, ['audio.wav']); // 3초 = 90프레임
  await tile(page, 'audio.wav').dragTo(lanes(page, 'audio').first(), { targetPosition: { x: 4, y: 20 } });
  const c = await audioClip(page);
  expect(c.duration).toBe(90);

  await drag(page, clipEl(page, c.id).getByTestId('fade-in-handle'), 600); // 훨씬 크게 끌기
  expect((await audioClip(page)).fadeIn).toBe(90); // 길이까지만

  await drag(page, clipEl(page, c.id).getByTestId('trim-end'), -100); // 50프레임으로 줄이기
  const trimmed = await audioClip(page);
  expect(trimmed.duration).toBe(40);
  expect(trimmed.fadeIn).toBe(40); // 페이드도 같이 줄어든다
});

test('미리보기가 볼륨·페이드 곡선을 그대로 적용한다 (R8.4)', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4'); // 0~120, 소리 있음
  await page.getByTestId('prop-volume').fill('80');
  await page.getByTestId('prop-fade-in').fill('1'); // 1초 = 30프레임
  await page.getByTestId('prop-fade-in').press('Enter');
  await page.getByTestId('prop-fade-out').fill('1');
  await page.getByTestId('prop-fade-out').press('Enter');
  const c = await videoClip(page);
  expect([c.volume, c.fadeIn, c.fadeOut]).toEqual([0.8, 30, 30]);

  // 재생하면서 여러 지점의 GainNode 값을 이론값과 비교한다
  await seekRuler(page, 0);
  await page.keyboard.press('Space');
  const seen: { frame: number; actual: number; expected: number }[] = [];
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(220);
    const s = await state(page);
    const f = s.ui.playhead;
    const g = await gain(page, c.id);
    if (g !== null && s.ui.playing) {
      seen.push({ frame: f, actual: g, expected: expectedGain(c as Required<typeof c>, f) });
    }
  }
  await page.keyboard.press('Space');
  test.info().annotations.push({ type: 'gain', description: JSON.stringify(seen.slice(0, 8)) });
  expect(seen.length).toBeGreaterThan(5);
  // 목표값으로 부드럽게 따라가므로(setTargetAtTime) 약간의 지연은 허용한다
  for (const s of seen) expect(Math.abs(s.actual - s.expected), `프레임 ${s.frame}`).toBeLessThan(0.15);
  // 페이드 인 구간에서는 최대 볼륨보다 작았던 순간이 있다
  expect(seen.some((s) => s.frame < 30 && s.actual < 0.7)).toBe(true);
});

test('트랙 음소거: BGM 트랙을 끄면 소리가 멎는다 (R8.3)', async ({ page }) => {
  await setup(page, ['audio.mp3']);
  await tile(page, 'audio.mp3').dragTo(lanes(page, 'audio').first(), { targetPosition: { x: 4, y: 20 } });
  const c = await audioClip(page);
  await seekRuler(page, 0);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await page.evaluate(() => window.__editor.preview()))!.level, { timeout: 4000 }).toBeGreaterThan(0.02);
  expect(await gain(page, c.id)).toBeGreaterThan(0.5);

  // 오디오 1 트랙 음소거 버튼 (영상 2, 영상 1, 오디오 1 순서 → 세 번째)
  await page.getByRole('button', { name: '음소거', exact: true }).nth(2).click();
  await expect.poll(async () => (await page.evaluate(() => window.__editor.preview()))!.level, { timeout: 3000 }).toBeLessThan(0.005);
  await expect.poll(async () => await gain(page, c.id)).toBeLessThan(0.02);
  expect((await state(page)).edit.tracks[3].muted).toBe(true);

  // 다시 켜면 돌아온다
  await page.getByRole('button', { name: '음소거 해제' }).click();
  await expect.poll(async () => await gain(page, c.id), { timeout: 3000 }).toBeGreaterThan(0.5);
  await page.keyboard.press('Space');
});

test('영상 클립의 소리도 같은 방식으로 조절된다', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'image.png']);
  await addViaPlus(page, 'color-steps.mp4');
  const v = await videoClip(page);
  // 영상 클립에도 페이드 핸들이 있다 (소리가 있으므로)
  await expect(clipEl(page, v.id).getByTestId('fade-in-handle')).toBeVisible();

  // 이미지 클립에는 소리가 없어 페이드 핸들이 없다
  await page.getByRole('tab', { name: '미디어' }).click();
  const img = await addViaPlus(page, 'image.png');
  await expect(clipEl(page, img).getByTestId('fade-in-handle')).toHaveCount(0);
  await expect(page.getByTestId('prop-volume')).toBeDisabled();
  await waitRendered(page, (await state(page)).ui.playhead);
});
