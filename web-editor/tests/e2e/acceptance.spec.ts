/**
 * 수용 기준 A1·A2·A4 (A3는 persist.spec.ts에서 확인한다).
 *
 * A1 1080p 클립 5개 60초 프로젝트에서 드래그·트림·재생이 버벅이지 않는다
 * A2 60초 1080×1920 내보내기에 걸린 시간을 기록한다 (합격선은 사용자 노트북에서 판단 — 러너에는 GPU가 없다)
 * A4 가져오기 → 분할 → 텍스트 추가 → 내보내기 기본 시나리오
 *
 * A1·A2는 큰 파일이 필요해 PERF_DIR이 있을 때만 돌린다 (`npm run fixtures:perf`).
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addViaPlus, clipEl, drag, seekRuler, setup, state, waitRendered } from './helpers';
import { fixture } from './fixtures';

const PERF_DIR = process.env.PERF_DIR;
const perfFiles = () => [1, 2, 3, 4, 5].map((i) => join(PERF_DIR!, `clip${i}.mp4`));

/** 메인 스레드가 오래 멈춘 횟수를 관찰한다 */
async function watchLongTasks(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __long: number[] }).__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (window as unknown as { __long: number[] }).__long.push(Math.round(e.duration)))).observe({
      type: 'longtask',
      buffered: false,
    });
  });
  return async () => page.evaluate(() => (window as unknown as { __long: number[] }).__long.splice(0));
}

async function buildLongProject(page: Page) {
  await setup(page, []);
  await page.getByTestId('import-input').setInputFiles(perfFiles());
  await expect(page.locator('[data-testid=media-item][data-status=ready]')).toHaveCount(5, { timeout: 180_000 });
  for (const b of await page.getByTestId('add-to-timeline').all()) await b.click({ force: true });
  const clips = (await state(page)).edit.tracks[2].clips;
  expect(clips.map((c) => c.start)).toEqual([0, 360, 720, 1080, 1440]);
  return clips;
}

test.describe('A1·A2 (큰 파일 필요)', () => {
  test.skip(!PERF_DIR, 'PERF_DIR이 없으면 건너뜀 — npm run fixtures:perf');

  test('A1: 1080p 5개 60초 프로젝트에서 재생·드래그·트림이 버벅이지 않는다', async ({ page }) => {
    test.setTimeout(300_000);
    const clips = await buildLongProject(page);
    const takeLong = await watchLongTasks(page);

    // 두 번째 클립 경계(12초)를 지나도록 8초부터 10초 재생
    await seekRuler(page, 240);
    await takeLong();
    await page.keyboard.press('Space');
    const samples: { fps: number; gap: number; drift: number }[] = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const p = (await page.evaluate(() => window.__editor.preview()))!;
      samples.push({ fps: p.drawFps, gap: p.maxGapMs, drift: Math.round(p.maxDrift * 1000) });
    }
    await page.keyboard.press('Space');
    const playLong = await takeLong();

    // 드래그·트림
    await seekRuler(page, 0);
    await takeLong();
    await drag(page, clipEl(page, clips[4].id), -60);
    await drag(page, clipEl(page, clips[4].id), 60);
    await drag(page, clipEl(page, clips[0].id).getByTestId('trim-end'), -80);
    await drag(page, clipEl(page, clips[0].id).getByTestId('trim-end'), 80);
    const editLong = await takeLong();

    const report = { samples, playLong, editLong };
    test.info().annotations.push({ type: 'A1', description: JSON.stringify(report) });
    console.log('A1 ' + JSON.stringify(report));

    // 드래그·트림 중에는 50ms 넘는 멈춤이 없어야 한다 — 2코어 CI 러너에서도 지켜지므로 어디서나 검사한다
    expect(editLong.filter((d) => d > 50)).toEqual([]);

    if (process.env.CI) {
      // GitHub 러너(2코어, GPU 없음, 소프트웨어 디코딩)는 A1이 말하는 "일반 노트북"이 아니다.
      // 여기서는 값만 기록하고(작업 요약에 표시), 재생이 멈춰 버리지 않는지만 본다.
      expect(Math.max(...samples.map((s) => s.gap))).toBeLessThan(1000);
      expect(samples.reduce((a, s) => a + s.fps, 0) / samples.length).toBeGreaterThan(20);
      return;
    }
    // 프레임 드롭 5% 미만 = 초당 57회 미만으로 그린 초가 1번 이하 (완료 기준 G2와 같은 잣대)
    const degraded = samples.slice(1).filter((s) => s.fps < 57).length;
    expect(degraded, `느려진 초: ${JSON.stringify(samples)}`).toBeLessThanOrEqual(1);
    // 화면이 멈춘 수준(250ms 이상)은 없어야 한다
    expect(Math.max(...samples.map((s) => s.gap))).toBeLessThan(250);
    // 영상·소리 차이 2프레임 이내
    expect(Math.max(...samples.map((s) => s.drift))).toBeLessThan(67);
  });

  test('A2: 60초 1080×1920 내보내기 시간을 기록한다', async ({ page }) => {
    test.setTimeout(900_000);
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    });
    await buildLongProject(page);
    expect((await state(page)).edit.ratio).toBe('9:16');

    await page.getByTestId('open-export').click();
    const started = Date.now();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 880_000 }),
      page.getByTestId('export-start').click(),
    ]);
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
    const wall = (Date.now() - started) / 1000;
    const summary = (await page.getByTestId('export-summary').textContent()) ?? '';
    const bytes = readFileSync(await download.path()).length;

    const info = await page.evaluate(() => window.__editor.verifyLastExport([1, 30, 55], [[0.5, 0.5]]));
    const report = {
      화면에표시: summary,
      실제걸린초: Number(wall.toFixed(1)),
      파일MB: Number((bytes / 1e6).toFixed(1)),
      해상도: `${info.info.width}x${info.info.height}`,
      프레임수: info.info.frameCount,
      영상길이: info.info.videoDuration,
    };
    test.info().annotations.push({ type: 'A2', description: JSON.stringify(report) });
    console.log('A2 ' + JSON.stringify(report));

    // 결과물이 올바른지는 여기서 확인하고, 60초 이내인지는 사용자 노트북에서 판단한다
    expect(info.info.width).toBe(1080);
    expect(info.info.height).toBe(1920);
    expect(info.info.frameCount).toBe(1800);
    expect(info.info.videoDuration).toBeCloseTo(60, 1);
    expect(summary).toMatch(/60\.0초 영상 · 내보내기 \d+\.\d초/);
  });
});

test('A4: 가져오기 → 분할 → 텍스트 추가 → 내보내기', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });

  // 1) 가져오기
  await setup(page, []);
  await page.getByTestId('import-input').setInputFiles([fixture('color-steps.mp4'), fixture('audio.mp3')]);
  await expect(page.locator('[data-testid=media-item][data-status=ready]')).toHaveCount(2, { timeout: 60_000 });
  const videoId = await addViaPlus(page, 'color-steps.mp4');

  // 2) 분할: 2초 지점에서 자르고 뒤쪽을 지운다 → 2초 영상
  await seekRuler(page, 60);
  await page.keyboard.press('KeyS');
  let clips = (await state(page)).edit.tracks[2].clips;
  expect(clips).toHaveLength(2);
  await clipEl(page, clips[1].id).click();
  await page.keyboard.press('Delete');
  clips = (await state(page)).edit.tracks[2].clips;
  expect(clips.map((c) => [c.start, c.duration])).toEqual([[0, 60]]);
  expect(clips[0].id).toBe(videoId);

  // 3) 텍스트 추가 — 텍스트는 플레이헤드 위치에 생기므로 처음으로 돌아간 뒤 넣는다
  await seekRuler(page, 0);
  await page.getByRole('tab', { name: '텍스트' }).click();
  await page.getByTestId('add-text').click();
  await page.getByTestId('text-content').fill('기본 시나리오');
  await page.getByTestId('text-content').blur();
  await page.locator('[data-testid=text-preset][data-preset-id="shorts-caption"]').click();
  await page.getByTestId('text-end').fill('2');
  await page.getByTestId('text-end').press('Enter');
  const textClip = (await state(page)).edit.tracks[0].clips[0];
  expect([textClip.start, textClip.duration]).toEqual([0, 60]); // 영상과 같은 길이
  await seekRuler(page, 30);
  await waitRendered(page, 30);

  // 4) 내보내기
  await page.getByTestId('open-export').click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.getByTestId('export-start').click()]);
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 180_000 });
  expect(download.suggestedFilename()).toBe('제목 없는 프로젝트.mp4');
  // 실제로 나온 파일을 결과물로 남긴다 (CI 아티팩트로 받아 볼 수 있게)
  await download.saveAs(test.info().outputPath('sample.mp4'));

  // 결과 확인: 1080×1920, 60프레임(2초), 영상+소리
  const r = await page.evaluate(() => window.__editor.verifyLastExport([0.5, 1.5], [[0.5, 0.5]]));
  expect(r.info.videoCodec).toBe('avc');
  expect(r.info.audioCodec).toBe('aac');
  expect([r.info.width, r.info.height]).toEqual([1080, 1920]);
  expect(r.info.frameCount).toBe(60);
  expect(r.info.videoDuration).toBeCloseTo(2, 2);
  expect(r.info.frameRate).toBe(30);
  test.info().annotations.push({ type: 'A4', description: JSON.stringify(r.info) });

  // 내보낸 뒤에도 작업은 그대로이고, 새로고침해도 남아 있다 (A3와 이어지는 확인)
  await page.getByTestId('export-close').click();
  const before = (await state(page)).edit;
  await page.evaluate(() => window.__editor.saveNow());
  await page.reload();
  await page.waitForFunction(() => typeof window.__editor?.state === 'function');
  expect((await state(page)).edit).toEqual(before);
});
