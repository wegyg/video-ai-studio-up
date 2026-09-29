/**
 * 2단계 4번: 속도 0.25~4배 + 음 높이 유지 (R17). 짧은 클립, 작은 해상도(360×640)로 확인한다.
 * color-steps.mp4: 원본 0-29 빨강, 30-59 초록, 60-89 파랑, 90-119 노랑.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { previewVsExport } from './compare';
import { addViaPlus, clipEl, colorName, pixel, seekRuler, setup, state, waitRendered } from './helpers';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const hasFfmpeg = (() => {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const main = async (page: Page) => (await state(page)).edit.tracks[2].clips;

async function colorAt(page: Page, frame: number) {
  await seekRuler(page, frame);
  await waitRendered(page, frame);
  return colorName(await pixel(page));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
});

test('2배·0.5배: 길이가 바뀌고 뒤 클립이 따라오며, 중간 프레임이 원본의 맞는 곳을 보여 준다', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'image.png']);
  const v = await addViaPlus(page, 'color-steps.mp4'); // 0~120
  await addViaPlus(page, 'image.png'); // 120~270
  await clipEl(page, v).click();
  await page.locator('[data-testid=speed-preset][data-speed="2"]').click();
  expect((await main(page)).map((c) => [c.start, c.duration, c.speed])).toEqual([
    [0, 60, 2],
    [60, 150, 1],
  ]);
  await expect(clipEl(page, v).getByTestId('clip-speed-badge')).toHaveText('2배');
  // 타임라인 f → 원본 2f
  expect(await colorAt(page, 10)).toBe('빨강'); // 20
  expect(await colorAt(page, 20)).toBe('초록'); // 40
  expect(await colorAt(page, 35)).toBe('파랑'); // 70
  expect(await colorAt(page, 50)).toBe('노랑'); // 100

  await page.getByTestId('prop-speed').fill('0.5');
  await page.getByTestId('prop-speed').press('Enter');
  expect((await main(page)).map((c) => [c.start, c.duration])).toEqual([
    [0, 240],
    [240, 150],
  ]);
  expect(await colorAt(page, 100)).toBe('초록'); // 50
  expect(await colorAt(page, 150)).toBe('파랑'); // 75
  await page.keyboard.press('Control+z');
  expect((await main(page))[0].speed).toBe(2);
});

test('재생: 미리보기 영상이 그 속도로 돌고, 음 높이 유지를 끄면 브라우저 설정도 꺼진다 · 새로고침해도 남는다', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  const v = await addViaPlus(page, 'color-steps.mp4');
  await clipEl(page, v).click();
  await page.locator('[data-testid=speed-preset][data-speed="2"]').click();
  await seekRuler(page, 0);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await page.evaluate((id) => window.__editor.mediaState(id), v))?.paused, { timeout: 5000 }).toBe(false);
  const m = (await page.evaluate((id) => window.__editor.mediaState(id), v))!;
  expect(m.rate).toBeGreaterThan(1.7);
  expect(m.rate).toBeLessThan(2.3);
  expect(m.preservesPitch).toBe(true);
  await page.keyboard.press('Space');

  await page.getByTestId('prop-keep-pitch').uncheck();
  expect((await main(page))[0].keepPitch).toBe(false);
  await seekRuler(page, 5);
  await expect.poll(async () => (await page.evaluate((id) => window.__editor.mediaState(id), v))?.preservesPitch).toBe(false);

  await page.evaluate(() => window.__editor.saveNow());
  await page.reload();
  await page.waitForFunction(() => typeof window.__editor?.state === 'function');
  await expect.poll(async () => (await main(page))[0]?.speed).toBe(2);
  expect((await main(page))[0].keepPitch).toBe(false);
});

test('내보낸 소리: 음 높이 유지면 660Hz 그대로 길이만 절반, 끄면 두 배 높이(1320Hz)', async ({ page }) => {
  test.skip(!hasFfmpeg, 'ffmpeg 필요');
  await setup(page, ['audio.wav']); // 660Hz, 3초
  const a = await addViaPlus(page, 'audio.wav');
  await clipEl(page, a).click();
  await page.locator('[data-testid=speed-preset][data-speed="2"]').click();
  expect((await main(page)).length).toBe(0); // 오디오 트랙에 들어간다
  const clip = (await state(page)).edit.tracks.flatMap((t) => t.clips).find((c) => c.id === a)!;
  expect(clip.duration).toBe(45);

  const measure = async (name: string) => {
    await page.getByTestId('open-export').click();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByTestId('export-start').click()]);
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('export-close').click();
    const file = test.info().outputPath(name);
    await dl.saveAs(file);
    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
    const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    // 0.3~1.2초의 영점 교차로 주파수 (원본은 크기만 오르내리고 0.18 아래로 내려가지 않는다)
    let n = 0;
    const i0 = Math.round(0.3 * 48000);
    const i1 = Math.round(1.2 * 48000);
    for (let i = i0 + 1; i < i1; i++) if (x[i - 1] < 0 !== x[i] < 0) n++;
    let tail = 0;
    for (let i = Math.round(1.55 * 48000); i < x.length; i++) tail = Math.max(tail, Math.abs(x[i]));
    return { hz: n / 2 / 0.9, tail };
  };
  const keep = await measure('speed-keep.mp4');
  const shift = await (async () => {
    await clipEl(page, a).click();
    await page.getByTestId('prop-keep-pitch').uncheck();
    return measure('speed-shift.mp4');
  })();
  console.log('SPEED_AUDIO ' + JSON.stringify({ keep, shift }));
  expect(Math.abs(keep.hz - 660) / 660).toBeLessThan(0.03);
  expect(Math.abs(shift.hz - 1320) / 1320).toBeLessThan(0.03);
  expect(keep.tail).toBeLessThan(0.01); // 1.5초 뒤에는 소리가 없다 (길이 절반)
});

test('미리보기 = 내보내기: 2배 영상과 0.5배 영상의 프레임 3곳 픽셀이 같다', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'pattern.mov']);
  const a = await addViaPlus(page, 'color-steps.mp4'); // 0~120
  const b = await addViaPlus(page, 'pattern.mov'); // 120~210
  await clipEl(page, a).click();
  await page.locator('[data-testid=speed-preset][data-speed="2"]').click(); // 0~60, b는 60~150
  await clipEl(page, b).click();
  await page.locator('[data-testid=speed-preset][data-speed="0.5"]').click(); // 60~240
  expect((await main(page)).map((c) => [c.start, c.duration])).toEqual([
    [0, 60],
    [60, 180],
  ]);
  const frames = [25, 101, 200];
  const diffs = await previewVsExport(page, frames, 'SPEED_EXPORT');
  for (let i = 0; i < frames.length; i++) expect(diffs[i], `프레임 ${frames[i]}`).toBeLessThanOrEqual(3);
});
