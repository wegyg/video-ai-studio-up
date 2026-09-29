/**
 * 배포 확인: DEPLOY_URL(예: https://wegyg.github.io/video-ai-studio-up/)이 있을 때만 실행한다.
 *   DEPLOY_URL=… npx playwright test deployed
 * 1) 배포본이 로컬 dist와 같은 빌드인지 (index.html의 번들 해시 비교)
 * 2) https에서 편집기가 뜨고, 실패한 요청이 없는지
 * 3) 배포본에서 디코딩·H.264/AAC 인코딩·글꼴이 실제로 되는지 (스파이크 재실행)
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../src/debug-types';
import { serveFixtures } from './fixtures';

const URL_ = process.env.DEPLOY_URL;
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');

test.skip(!URL_, 'DEPLOY_URL이 없으면 건너뜀');

test('배포본: 최신 빌드 + 편집기 동작', async ({ page }) => {
  const bundle = readFileSync(join(DIST, 'index.html'), 'utf8').match(/assets\/index-[\w-]+\.js/)![0];
  const html = await (await page.request.get(URL_!)).text();
  expect(html, '배포본이 로컬 최신 빌드와 같아야 함').toContain(bundle);

  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('__fixtures__')) failed.push(`${r.status()} ${r.url()}`);
  });
  await serveFixtures(page);
  await page.goto(URL_!);
  await expect(page.getByTestId('timeline')).toBeVisible();
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);

  const r = await page.evaluate(async () => window.__editor.spike(await (await fetch('./__fixtures__/color-steps.mp4')).blob()));
  expect(r.encode.out.videoCodec).toBe('avc');
  expect(r.encode.out.audioCodec).toBe('aac');
  expect(Object.values(r.fonts).every(Boolean)).toBe(true);
  expect(failed).toEqual([]);
});
