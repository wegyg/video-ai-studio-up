/**
 * 수용 기준 A4: 가져오기 → 분할 → 텍스트 추가 → 내보내기 (A3는 persist.spec.ts).
 * A1(재생 성능)·A2(내보내기 시간)는 사용자가 Windows 노트북에서 확인한다 — GPU 없는 샌드박스·CI 숫자는
 * 노트북 성능을 대표하지 못해 측정하지 않는다 (docs/perf.md).
 */
import { expect, test } from '@playwright/test';
import { addViaPlus, clipEl, seekRuler, setup, state, waitRendered } from './helpers';
import { fixture } from './fixtures';

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
