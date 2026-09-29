/**
 * 원본 색 해석: 미리보기(<video>)와 내보내기(WebCodecs)가 같은 원본을 같은 색으로 푸는가 (G3).
 *
 * Chrome은 색 정보가 셋(primaries·transfer·matrix) 다 있을 때만 그대로 쓰고, 아니면 세로 720 미만은
 * BT.601, 이상은 BT.709로 가정한다. 내보내기 디코더도 같은 값을 쓰도록 맞췄다(src/media/color.ts).
 * 확인 2까지의 비교는 모두 540×960(HD 규칙) 원본이라 SD 원본의 색 차이(평균 8/255)를 놓쳤다.
 */
import { expect, test } from '@playwright/test';
import { previewVsExport } from './compare';
import { serveFixtures } from './fixtures';
import { addViaPlus, setup } from './helpers';

const cases: { file: string; frame: number; applied: string | null; note: string }[] = [
  { file: 'pattern.mov', frame: 45, applied: 'smpte170m', note: '640×360 색 정보 없음 → BT.601' },
  { file: 'color-steps.mp4', frame: 45, applied: 'bt709', note: '540×960 색 정보 없음 → BT.709' },
  { file: 'color-matrix-only-sd.mp4', frame: 7, applied: 'smpte170m', note: 'matrix만 있음 → 무시하고 BT.601' },
  { file: 'color-tag709-sd.mp4', frame: 7, applied: null, note: 'SD지만 BT.709로 다 적힘 → 적힌 값' },
];

test('원본을 푸는 두 길(<video> / 내보내기 디코더)의 색이 같다', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('./');
  await page.waitForFunction(() => typeof window.__editor?.decodePaths === 'function');
  for (const c of cases) {
    const r = await page.evaluate(
      async ([file, frame]) => window.__editor.decodePaths(await (await fetch(`./__fixtures__/${file}`)).blob(), frame as number),
      [c.file, c.frame] as const,
    );
    console.log(`DECODE_COLOR ${c.file} applied=${r.applied?.matrix ?? '-'} diff=${r.meanAbs.toFixed(2)}`);
    expect(r.applied?.matrix ?? null, `${c.file}: ${c.note}`).toBe(c.applied);
    expect(r.meanAbs, `${c.file}: ${c.note}`).toBeLessThan(0.5);
  }
});

test('미리보기 = 내보내기: 색 정보 없는 SD 원본(640×360)도 필터 없이 같은 색으로 나온다', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await setup(page, ['pattern.mov']);
  await addViaPlus(page, 'pattern.mov');
  const frames = [10, 45, 80];
  const diffs = await previewVsExport(page, frames, 'SD_EXPORT');
  for (let i = 0; i < frames.length; i++) expect(diffs[i], `프레임 ${frames[i]}`).toBeLessThanOrEqual(3);
});
