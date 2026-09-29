/**
 * 태스크 0 스파이크: 이 Chrome에서 1단계 핵심 경로(디코딩, H.264/AAC 인코딩, 글꼴)가 되는지 확인한다.
 * 결과는 test-results/…/spike.json에 저장하고 콘솔에도 출력한다(docs/spike.md 기록용).
 */
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import '../../src/debug-types';
import { serveFixtures } from './fixtures';

test('스파이크: 디코딩·인코딩·글꼴 지원 확인', async ({ page, browser }, testInfo) => {
  await serveFixtures(page);
  await page.goto('./');
  await page.waitForFunction(() => typeof window.__editor?.spike === 'function');

  const result = await page.evaluate(async () => {
    const blob = await (await fetch('./__fixtures__/color-steps.mp4')).blob();
    return window.__editor.spike(blob);
  });
  const report = { browserVersion: browser.version(), userAgent: await page.evaluate(() => navigator.userAgent), ...result };
  writeFileSync(testInfo.outputPath('spike.json'), JSON.stringify(report, null, 2));
  console.log('SPIKE_RESULT ' + JSON.stringify(report));

  // 1단계 필수 조건
  expect(result.support.secureContext).toBe(true);
  expect(result.support.webcodecs).toBe(true);
  expect(result.support.avcEncode).toBe(true);

  expect(result.decode.codec).toBe('avc');
  expect(result.decode.canDecode).toBe(true);
  expect(result.decode.width).toBe(540);
  expect(result.decode.height).toBe(960);
  expect(result.decode.duration).toBeCloseTo(4, 1);
  const [r, g, b] = result.decode.pixelAt2_5s;
  expect(b).toBeGreaterThan(200); // 2~3초 구간 = 파랑
  expect(r).toBeLessThan(40);
  expect(g).toBeLessThan(40);

  expect(result.encode.out.videoCodec).toBe('avc');
  expect(result.encode.out.audioCodec).toBe('aac');
  expect(result.encode.out.width).toBe(1080);
  expect(result.encode.out.height).toBe(1920);
  expect(result.encode.out.duration).toBeCloseTo(2, 1);

  for (const [name, ok] of Object.entries(result.fonts)) expect(ok, `글꼴 ${name}`).toBe(true);
});
