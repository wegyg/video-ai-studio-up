import { defineConfig } from 'vitest/config';

// 단위 테스트는 src/**/*.test.ts 만 (Playwright E2E는 tests/e2e).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
