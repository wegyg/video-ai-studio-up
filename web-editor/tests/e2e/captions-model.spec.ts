/**
 * 실제 Whisper 모델로 자동 자막이 끝까지 도는지 확인한다 (R20).
 * 수백 MB를 내려받으므로 `WHISPER=1`을 줄 때만 돈다 (CI에서는 건너뜀).
 * 정확도(한국어를 제대로 알아듣는지)는 사용자가 실제 음성으로 확인한다 — 여기서는 경로와 진행률만 본다.
 * 가장 작은 모델(빠름 = tiny)과 3초 소리만 쓴다.
 */
import { expect, test } from '@playwright/test';
import { addViaPlus, clipEl, setup, state } from './helpers';

test.skip(!process.env.WHISPER, 'WHISPER=1 일 때만 (인식 모델을 내려받는다)');

test('실제 모델(빠름·tiny): 3초 소리로 모델 준비 → 인식 → 자막 만들기가 끝까지 돈다', async ({ page }) => {
  test.setTimeout(900_000);
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('PAGE_ERROR ' + m.text().slice(0, 300));
  });
  await setup(page, ['audio.wav']); // 660Hz 3초
  const a = await addViaPlus(page, 'audio.wav');
  await clipEl(page, a).click();
  await page.getByRole('tab', { name: '자막' }).click();
  await page.getByTestId('captions-source-clip').click();
  await page.getByTestId('captions-model-fast').click();

  const t0 = Date.now();
  await page.getByTestId('captions-start').click();
  await expect(page.getByTestId('captions-progress')).toBeVisible();
  // 모델을 받거나 준비하는 단계가 화면에 보인다 (진행률 포함)
  await expect
    .poll(() => page.getByTestId('captions-progress').textContent(), { timeout: 600_000, intervals: [1000] })
    .toMatch(/내려받는 중|알아듣는 중/);
  await expect(page.getByTestId('captions-done')).toBeVisible({ timeout: 780_000 });
  await expect(page.getByTestId('captions-error')).toHaveCount(0);
  const done = (await page.getByTestId('captions-done').textContent()) ?? '';
  const texts = (await state(page)).edit.tracks.filter((t) => t.kind === 'text').flatMap((t) => t.clips.map((c) => c.text));
  console.log('WHISPER_RESULT ' + JSON.stringify({ wallSec: Math.round((Date.now() - t0) / 1000), done: done.slice(0, 120), texts }));
  expect(done).toContain('자막');
  expect(done).toMatch(/그래픽 가속|CPU/);

  // 두 번째 실행은 모델이 캐시되어 내려받기 없이 시작한다 (R0.2)
  const t1 = Date.now();
  await page.getByTestId('captions-start').click();
  await expect(page.getByTestId('captions-done')).toBeVisible({ timeout: 300_000 });
  console.log('WHISPER_CACHED ' + JSON.stringify({ wallSec: Math.round((Date.now() - t1) / 1000) }));
});
