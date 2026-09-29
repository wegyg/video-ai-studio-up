/**
 * 2단계 3번: 키프레임 (R16) — 위치·크기·회전·투명도·볼륨, 이징(선형·부드럽게).
 * 짧은 클립(이미지 5초, 소리 3초)과 작은 해상도(360×640)로 빠르게 확인한다.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { previewVsExport } from './compare';
import { fixture } from './fixtures';
import { addViaPlus, clipEl, pixel, seekRuler, setup, state, waitRendered } from './helpers';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const box = (page: Page, id: string) => page.evaluate((i) => window.__editor.clipBox(i), id);
const clipById = async (page: Page, id: string) => (await state(page)).edit.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;

async function setField(page: Page, testId: string, value: string) {
  const f = page.getByTestId(testId);
  await f.fill(value);
  await f.press('Enter');
}

/** 이미지 클립(0~150, 청록 400×400)을 넣고 0·60프레임에 위치·크기·회전·투명도 키를 만든다 */
async function keyedImage(page: Page) {
  await setup(page, ['image.png']);
  const id = await addViaPlus(page, 'image.png');
  await clipEl(page, id).click();
  await seekRuler(page, 0);
  for (const k of ['key-x-y', 'key-scale', 'key-rotation', 'key-opacity']) await page.getByTestId(k).click();
  await expect(page.getByTestId('key-x-y')).toHaveAttribute('aria-pressed', 'true');
  await seekRuler(page, 60);
  await expect(page.getByTestId('key-x-y')).toHaveAttribute('aria-pressed', 'false');
  await setField(page, 'prop-x', '300');
  await setField(page, 'prop-scale', '150');
  await setField(page, 'prop-rotation', '90');
  await page.getByTestId('prop-opacity').fill('50');
  return id;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
});

test('키 두 개 사이가 움직인다: 중간 프레임의 위치·크기·회전·투명도, 부드럽게 이징', async ({ page }) => {
  const id = await keyedImage(page);
  const c = await clipById(page, id);
  expect(c.keyframes?.x).toEqual([
    { f: 0, v: 0, ease: 'linear' },
    { f: 60, v: 300, ease: 'linear' },
  ]);
  expect(c.keyframes?.opacity?.map((k) => k.v)).toEqual([1, 0.5]);
  await seekRuler(page, 0);
  const start = (await box(page, id))!;
  await seekRuler(page, 30);
  await waitRendered(page, 30);
  const b = (await box(page, id))!;
  expect(b.cx - start.cx).toBeCloseTo(150, 0); // 가운데 = 절반
  expect(b.w / start.w).toBeCloseTo(1.25, 2);
  expect(b.rotation).toBeCloseTo(45, 1);
  await expect(page.getByTestId('prop-x')).toHaveValue('150'); // 속성 패널도 지금 값을 보여 준다
  // 투명도 0.75: 청록(0,255,255)이 검정 위에 75%
  const px = await pixel(page);
  expect(Math.abs(px[1] - 191)).toBeLessThanOrEqual(4);

  // 부드럽게: 1/4 지점은 선형(75)보다 덜 갔다 (300 × 0.15625 = 46.9)
  await seekRuler(page, 0);
  await page.getByTestId('key-ease').selectOption('smooth');
  await seekRuler(page, 15);
  await waitRendered(page, 15);
  expect((await box(page, id))!.cx - start.cx).toBeCloseTo(46.875, 0);
});

test('타임라인 ◆: 누르면 그 시각으로, 끌면 키가 옮겨지고(기록 1개) Ctrl+Z로 돌아온다 · 새로고침해도 남는다', async ({ page }) => {
  const id = await keyedImage(page);
  const markers = clipEl(page, id).getByTestId('keyframe');
  await expect(markers).toHaveCount(2);
  await markers.first().click();
  expect((await state(page)).ui.playhead).toBe(0);

  const past = (await state(page)).history.past;
  const m = (await markers.nth(1).boundingBox())!;
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
  await page.mouse.down();
  await page.mouse.move(m.x + m.width / 2 + 40, m.y + m.height / 2, { steps: 8 }); // 기본 줌 2px/프레임 → +20프레임
  await page.mouse.up();
  const c = await clipById(page, id);
  expect(c.keyframes?.x?.map((k) => k.f)).toEqual([0, 80]);
  expect(c.keyframes?.scale?.map((k) => k.f)).toEqual([0, 80]); // 그 시각의 모든 속성 키가 함께
  expect((await state(page)).history.past).toBe(past + 1);
  expect((await state(page)).ui.playhead).toBe(80);
  await page.keyboard.press('Control+z');
  expect((await clipById(page, id)).keyframes?.x?.map((k) => k.f)).toEqual([0, 60]);

  // ◀◆ ◆▶ 이동 (실행 취소는 플레이헤드를 옮기지 않으므로 지금 80), ◆ 다시 누르면 그 키가 빠진다
  await page.getByTestId('key-prev').click();
  expect((await state(page)).ui.playhead).toBe(60);
  await page.getByTestId('key-prev').click();
  expect((await state(page)).ui.playhead).toBe(0);
  await page.getByTestId('key-next').click();
  expect((await state(page)).ui.playhead).toBe(60);
  await page.getByTestId('key-rotation').click();
  expect((await clipById(page, id)).keyframes?.rotation?.map((k) => k.f)).toEqual([0]);

  await page.evaluate(() => window.__editor.saveNow());
  await page.reload();
  await page.waitForFunction(() => typeof window.__editor?.state === 'function');
  await expect.poll(async () => (await clipById(page, id))?.keyframes?.x?.map((k) => k.v)).toEqual([0, 300]);
});

test('볼륨 키: 미리보기 소리와 내보낸 파일의 소리가 같은 곡선을 따른다 (0 → 100%, 0~2초)', async ({ page }) => {
  let hasFfmpeg = true;
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
  } catch {
    hasFfmpeg = false;
  }
  test.skip(!hasFfmpeg, 'ffmpeg 필요');
  await setup(page, ['audio.wav']);
  const id = await addViaPlus(page, 'audio.wav'); // 0~90 (3초)
  await clipEl(page, id).click();
  await seekRuler(page, 0);
  await page.getByTestId('prop-volume').fill('0');
  await page.getByTestId('key-volume').click();
  await seekRuler(page, 60);
  await page.getByTestId('prop-volume').fill('100');
  expect((await clipById(page, id)).keyframes?.volume).toEqual([
    { f: 0, v: 0, ease: 'linear' },
    { f: 60, v: 1, ease: 'linear' },
  ]);

  // 미리보기: 재생 중 GainNode 값이 그 순간의 곡선 값과 같다
  await seekRuler(page, 0);
  await page.keyboard.press('Space');
  const samples: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(180);
    const [f, g] = await page.evaluate((i) => [window.__editor.state().ui.playhead, window.__editor.clipGain(i) ?? -1], id);
    if (f > 3 && f < 57) samples.push([f, g]);
  }
  await page.keyboard.press('Space');
  expect(samples.length).toBeGreaterThanOrEqual(3);
  for (const [f, g] of samples) expect(Math.abs(g - f / 60), `프레임 ${f}: ${g}`).toBeLessThan(0.12);

  // 내보내기: 파일 소리 크기 / 원본 소리 크기 = 곡선 값
  await page.getByTestId('open-export').click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByTestId('export-start').click()]);
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
  const file = test.info().outputPath('keyframe-volume.mp4');
  await download.saveAs(file);
  const pcm = (f: string) => {
    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', f, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  };
  const rms = (x: Float32Array, a: number, b: number) => {
    let s = 0;
    const i0 = Math.round(a * 48000);
    const i1 = Math.round(b * 48000);
    for (let i = i0; i < i1; i++) s += x[i] * x[i];
    return Math.sqrt(s / (i1 - i0));
  };
  const out = pcm(file);
  const src = pcm(fixture('audio.wav'));
  // 원본 소리 크기가 가장 평평한 순간(0.75초, 1.25초 …)에서 잰다 — 원본은 0.5초마다 커졌다 작아진다
  const ratios = [0.75, 1.25, 1.75, 2.25].map((t) => {
    const r = rms(out, t - 0.05, t + 0.05) / rms(src, t - 0.05, t + 0.05);
    return { t, r: Number(r.toFixed(3)), want: Math.min(1, t / 2) };
  });
  console.log('KEYFRAME_VOLUME ' + JSON.stringify(ratios));
  for (const x of ratios) expect(Math.abs(x.r - x.want), `${x.t}초`).toBeLessThan(0.05);
});

test('미리보기 = 내보내기: 키프레임으로 움직이는 이미지·텍스트의 프레임 3곳 픽셀이 같다', async ({ page }) => {
  const id = await keyedImage(page);
  // 텍스트도 위치 키 (부드럽게)
  await seekRuler(page, 0);
  await page.getByRole('tab', { name: '텍스트' }).click();
  await page.getByTestId('add-text').click();
  const text = (await state(page)).edit.tracks[0].clips[0].id;
  await page.getByTestId('key-x-y').click();
  await page.getByTestId('key-ease').selectOption('smooth');
  await seekRuler(page, 60);
  await setField(page, 'prop-y', '-500');
  expect((await clipById(page, text)).keyframes?.y?.map((k) => k.v)).toEqual([0, -500]);
  void id;

  const frames = [10, 30, 50];
  const diffs = await previewVsExport(page, frames, 'KEYFRAME_EXPORT');
  for (let i = 0; i < frames.length; i++) expect(diffs[i], `프레임 ${frames[i]}`).toBeLessThanOrEqual(3);
});
