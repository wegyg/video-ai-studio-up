/**
 * 성능 측정 (수용 기준 A1의 바탕): 1080p 12초 클립 5개 = 60초 프로젝트에서 재생·드래그·트림.
 * 큰 파일은 저장소에 넣지 않으므로 PERF_DIR(clip1.mp4 … clip5.mp4가 있는 폴더)이 있을 때만 실행한다.
 *   PERF_DIR=/tmp/perf npx playwright test perf
 * 태스크 13에서 CI용으로 파일을 준비해 수용 기준 테스트로 만든다.
 */
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { clipEl, drag, setup, state } from './helpers';

const DIR = process.env.PERF_DIR;
test.skip(!DIR, 'PERF_DIR이 없으면 건너뜀');

test('1080p × 5 (60초): 재생 프레임 드롭, 드래그/트림 중 긴 작업', async ({ page }) => {
  test.setTimeout(180_000);
  await setup(page, []);
  const files = [1, 2, 3, 4, 5].map((i) => join(DIR!, `clip${i}.mp4`));
  await page.getByTestId('import-input').setInputFiles(files);
  await expect(page.locator('[data-testid=media-item][data-status=ready]')).toHaveCount(5, { timeout: 120_000 });
  for (const t of await page.getByTestId('add-to-timeline').all()) await t.click({ force: true });
  expect((await state(page)).edit.tracks[2].clips.map((c) => c.start)).toEqual([0, 360, 720, 1080, 1440]);

  // 긴 작업(50ms 넘는 메인 스레드 작업) 관찰 시작
  await page.evaluate(() => {
    (window as any).__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (window as any).__long.push(Math.round(e.duration)))).observe({
      type: 'longtask',
      buffered: false,
    });
  });
  const longTasks = async () => {
    const v = await page.evaluate(() => (window as any).__long.splice(0) as number[]);
    return v;
  };

  // 재생 10초: 두 번째 클립 경계(12초)를 지나도록 8초부터
  await page.getByTestId('ruler').click({ position: { x: 240 * 2, y: 10 } });
  await longTasks();
  await page.keyboard.press('Space');
  const samples: { fps: number; gap: number; drift: number }[] = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const p = (await page.evaluate(() => window.__editor.preview()))!;
    samples.push({ fps: p.drawFps, gap: p.maxGapMs, drift: Math.round(p.maxDrift * 1000) });
  }
  await page.keyboard.press('Space');
  const playLong = await longTasks();

  // 드래그/트림
  const ids = (await state(page)).edit.tracks[2].clips.map((c) => c.id);
  await page.getByTestId('ruler').click({ position: { x: 0, y: 10 } });
  await longTasks();
  await drag(page, clipEl(page, ids[4]), -60);
  await drag(page, clipEl(page, ids[4]), 60);
  await drag(page, clipEl(page, ids[0]).getByTestId('trim-end'), -80);
  await drag(page, clipEl(page, ids[0]).getByTestId('trim-end'), 80);
  const editLong = await longTasks();

  const report = { samples, playLong, editLong };
  test.info().annotations.push({ type: 'perf', description: JSON.stringify(report) });
  console.log('PERF ' + JSON.stringify(report));
  const drops = samples.slice(1).filter((s) => s.fps < 57).length;
  expect(editLong.filter((d) => d > 50)).toEqual([]);
  expect(drops).toBeLessThanOrEqual(1);
});
