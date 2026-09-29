/**
 * 태스크 10: MP4 내보내기.
 * 완료 기준 G3("내보낸 MP4가 미리보기와 똑같은가")를 여기서 증명한다.
 * 파일 선택 창은 테스트에서 띄울 수 없으므로 showSaveFilePicker를 없애 다운로드 경로를 검증한다.
 */
import { expect, test, type Download, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addViaPlus, lanes, seekRuler, setup, state, tile, waitRendered } from './helpers';
import { fixture } from './fixtures';

/** 미리보기와 비교할 좌표 (0~1). 글자 테두리에 몰리지 않게 넓게 퍼뜨린다 */
const POINTS: [number, number][] = [
  [0.2, 0.1],
  [0.5, 0.1],
  [0.8, 0.1],
  [0.2, 0.3],
  [0.8, 0.3],
  [0.5, 0.5],
  [0.2, 0.7],
  [0.8, 0.7],
  [0.2, 0.9],
  [0.5, 0.9],
  [0.8, 0.9],
];

test.beforeEach(async ({ page }) => {
  // 저장 위치 고르기 창을 띄울 수 없는 환경 → 다운로드로 저장하는 길을 검증한다
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
});

/**
 * 내보내기를 끝까지 돌린다. 픽셀 비교는 페이지 안에 남아 있는 같은 바이트로 하고
 * (Playwright는 ArrayBuffer를 페이지로 넘기지 못한다), 내려받은 파일은 따로 확인한다.
 */
async function runExport(page: Page): Promise<{ download: Download; summary: string; fileBytes: Buffer }> {
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByTestId('export-start').click()]);
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 });
  const summary = (await page.getByTestId('export-summary').textContent()) ?? '';
  const fileBytes = readFileSync(await download.path());
  // 내려받은 파일이 정말 MP4다 (ftyp 박스)
  expect(fileBytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
  expect(fileBytes.length).toBe(await page.evaluate(() => window.__editor.lastExportBytes()));
  return { download, summary, fileBytes };
}

const verify = (page: Page, times: number[], points: [number, number][]) =>
  page.evaluate(([t, p]) => window.__editor.verifyLastExport(t as number[], p as [number, number][]), [times, points] as const);

test('G3: 내보낸 MP4가 미리보기와 같다 (영상·텍스트·비율)', async ({ page }) => {
  test.setTimeout(180_000);
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4'); // 0~120 (4초)
  // 텍스트도 얹어 같은 합성 경로를 쓰는지 확인한다
  await page.getByRole('tab', { name: '텍스트' }).click();
  await page.getByTestId('add-text').click();
  await page.getByTestId('text-content').fill('내보내기 확인');
  await page.getByTestId('text-content').blur();
  await page.getByTestId('anim-in').selectOption('none');
  await page.getByTestId('anim-out').selectOption('none');
  await page.getByTestId('text-start').fill('0');
  await page.getByTestId('text-start').press('Enter');
  await page.getByTestId('text-end').fill('4');
  await page.getByTestId('text-end').press('Enter');

  // 미리보기 픽셀을 먼저 기록한다 (프레임 3곳)
  const frames = [15, 45, 100];
  const before: number[][][] = [];
  for (const f of frames) {
    await seekRuler(page, f);
    await waitRendered(page, f);
    before.push(await page.evaluate((pts) => window.__editor.previewPixels(pts as [number, number][]), POINTS));
  }

  const { summary } = await runExport(page);
  expect(summary).toMatch(/4\.0초 영상 · 내보내기 \d+\.\d초/);

  // 내보낸 파일을 다시 읽어 같은 시간의 픽셀과 비교한다
  const result = await verify(page, frames.map((f) => f / 30 + 0.001), POINTS);
  test.info().annotations.push({ type: 'export-info', description: JSON.stringify(result.info) });

  expect(result.info.videoCodec).toBe('avc');
  expect(result.info.audioCodec).toBe('aac');
  expect(result.info.width).toBe(1080);
  expect(result.info.height).toBe(1920);
  expect(result.info.frameCount).toBe(120);
  expect(result.info.videoDuration).toBeCloseTo(4, 2);

  // 채널당 평균 차이 3 이하 (G3)
  const diffs: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const a = before[i];
    const b = result.frames[i].pixels;
    expect(b.length, `프레임 ${frames[i]} 디코딩`).toBe(POINTS.length);
    let sum = 0;
    let n = 0;
    for (let p = 0; p < a.length; p++) {
      for (let c = 0; c < 3; c++) {
        sum += Math.abs(a[p][c] - b[p][c]);
        n++;
      }
    }
    diffs.push(sum / n);
  }
  test.info().annotations.push({ type: 'pixel-diff', description: JSON.stringify(diffs.map((d) => Number(d.toFixed(2)))) });
  for (let i = 0; i < diffs.length; i++) expect(diffs[i], `프레임 ${frames[i]} 평균 차이`).toBeLessThanOrEqual(3);
});

test('16:9 비율도 그 해상도로 나온다', async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page, ['image.png']);
  await addViaPlus(page, 'image.png');
  await page.getByRole('radio', { name: '가로 16:9' }).click();
  await runExport(page);
  const r = await verify(page, [0.1], [[0.5, 0.5]]);
  expect([r.info.width, r.info.height]).toEqual([1920, 1080]);
  // 이미지만 있으면 소리 트랙은 없다
  expect(r.info.audioCodec).toBeNull();
});

test('진행률·남은 시간이 보이고 취소하면 멈춘다 (R11.5, R11.6)', async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4');
  // 길게 만들어 취소할 틈을 준다
  await page.getByTestId('prop-fade-in').fill('0');
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-start').click();

  await expect(page.getByTestId('export-bar')).toBeVisible();
  await expect.poll(async () => Number((await page.getByTestId('export-percent').textContent())?.replace('%', '')), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('export-dialog')).toContainText('걸린 시간');
  await expect(page.getByTestId('export-dialog')).toContainText('남은 시간');

  await page.getByTestId('export-cancel').click();
  // 취소하면 다시 시작할 수 있는 상태로 돌아온다
  await expect(page.getByTestId('export-start')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('export-done')).toHaveCount(0);
});

test('빈 타임라인은 내보내기 버튼이 잠긴다', async ({ page }) => {
  await setup(page, []);
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('export-start')).toBeDisabled();
  await expect(page.getByTestId('export-dialog')).toContainText('타임라인이 비어 있습니다');
  await page.getByTestId('export-close').click();
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);
});

test('소리: BGM과 영상 소리가 함께 들어가고, 음소거한 트랙은 빠진다 (R8.4, G3)', async ({ page }) => {
  test.setTimeout(150_000);
  await setup(page, ['color-steps.mp4', 'audio.mp3']);
  await addViaPlus(page, 'color-steps.mp4');
  await tile(page, 'audio.mp3').dragTo(lanes(page, 'audio').first(), { targetPosition: { x: 4, y: 20 } });
  const withBoth = await runExport(page);
  const a = await verify(page, [0.1], [[0.5, 0.5]]);
  expect(a.info.audioCodec).toBe('aac');
  expect(withBoth.fileBytes.length).toBeGreaterThan(10_000);

  // 모든 소리 트랙을 음소거하면 소리 트랙 없이 나온다
  await page.getByTestId('export-close').click();
  // 음소거하면 버튼 이름이 "음소거 해제"로 바뀌므로, 남아 있는 첫 버튼을 계속 누른다
  const muteButton = page.getByRole('button', { name: '음소거', exact: true });
  for (let left = await muteButton.count(); left > 0; left--) await muteButton.first().click();
  await expect(muteButton).toHaveCount(0);
  await runExport(page);
  const m = await verify(page, [0.1], [[0.5, 0.5]]);
  expect(m.info.audioCodec).toBeNull();
});

test('내보낸 뒤에도 편집 상태가 그대로 남는다', async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page, ['image.png']);
  await addViaPlus(page, 'image.png');
  const before = (await state(page)).edit;
  await runExport(page);
  await page.getByTestId('export-close').click();
  expect((await state(page)).edit).toEqual(before);
  await expect(page.getByTestId('timeline')).toBeVisible();
});
