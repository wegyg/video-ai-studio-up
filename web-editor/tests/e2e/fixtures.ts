/** E2E 공용: 테스트 파일 경로와, 페이지가 테스트 파일을 fetch할 수 있게 해 주는 라우트. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const fixture = (name: string) => join(FIXTURES, name);

/** 페이지에서 fetch('./__fixtures__/<이름>')으로 테스트 파일을 받을 수 있게 한다 (dist에는 포함되지 않음). */
export async function serveFixtures(page: Page): Promise<void> {
  await page.route('**/__fixtures__/**', (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/__fixtures__/')[1]);
    return route.fulfill({ path: fixture(name) });
  });
}
