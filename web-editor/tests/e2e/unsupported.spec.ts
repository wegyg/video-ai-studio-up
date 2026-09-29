/** R1.3: WebCodecs를 쓸 수 없는 환경 안내 */
import { expect, test } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');

test('WebCodecs가 없는 브라우저면 한국어 안내 화면', async ({ page }) => {
  await page.addInitScript(() => {
    for (const k of ['VideoEncoder', 'VideoDecoder', 'AudioEncoder', 'AudioDecoder']) delete (window as any)[k];
  });
  await page.goto('./');
  const box = page.getByTestId('unsupported');
  await expect(box).toBeVisible();
  await expect(box).toContainText('WebCodecs');
  await expect(box).toContainText('npx serve dist');
  await expect(page.getByTestId('timeline')).toHaveCount(0);
});

test('file://로 열면 안내가 보인다', async ({ page }) => {
  await page.goto(pathToFileURL(join(DIST, 'index.html')).href);
  const notice = page.locator('#file-protocol-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('npx serve dist');
});
