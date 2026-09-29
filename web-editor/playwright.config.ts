import { defineConfig } from '@playwright/test';

// 테스트 대상은 정적 빌드(dist/)를 `vite preview`로 띄운 것이다. 먼저 `npm run build`.
// 브라우저는 실제 Google Chrome(chrome 채널, Chromium 엔진) 하나만 쓴다.
// 번들 Chromium에는 H.264/AAC가 없어 사용자 환경(Windows Chrome)과 다르게 동작한다.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // BASE_URL을 주면 배포된 사이트를 대상으로 같은 테스트를 돌린다 (예: GitHub Pages 주소)
    baseURL: process.env.BASE_URL ?? 'http://localhost:4173/',
    viewport: { width: 1536, height: 864 }, // Windows 노트북 1920x1080 @125% 배율과 같은 크기
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run preview',
        url: 'http://localhost:4173/',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
