/**
 * 2단계 1번: 캔버스 흐림 채우기 배경 + 필터 프리셋 12종 + 조정 슬라이더 6종 (R15, R18).
 * 규칙: 필터를 적용한 같은 프레임을 미리보기와 내보낸 MP4 두 곳에서 뽑아 픽셀을 비교한다.
 */
import { expect, test } from '@playwright/test';
import { adjustPixel, FILTER_PRESETS } from '../../src/model/filters';
import { previewGrid, previewVsExport } from './compare';
import { addViaPlus, clipEl, colorName, pixel, seekRuler, setup, state, waitRendered } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
});

test('필터 12종 + 원본: 누르면 바로 바뀌고, 색 계산이 설계식과 같다 (단색 화면)', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4');
  await page.getByRole('tab', { name: '효과' }).click();
  await expect(page.getByTestId('filter-preset')).toHaveCount(13);
  // 썸네일도 실제 셰이더로 만들어진다
  await expect(page.locator('[data-testid=filter-preset] img')).toHaveCount(13, { timeout: 10_000 });

  const frames: [number, number[]][] = [
    [15, [255, 0, 0]], // 원본 빨강 (소스 색은 원본 디코딩 값으로 다시 읽는다)
    [45, [0, 255, 0]],
  ];
  const seen = new Set<string>();
  for (const [f] of frames) {
    await seekRuler(page, f);
    await waitRendered(page, f);
    await page.locator('[data-testid=filter-preset][data-preset-id=none]').click();
    await waitRendered(page, f);
    const original = await pixel(page); // 필터 없는 실제 원본 색
    for (const preset of FILTER_PRESETS) {
      await page.locator(`[data-testid=filter-preset][data-preset-id="${preset.id}"]`).click();
      await expect.poll(async () => (await state(page)).edit.tracks[2].clips[0].filter?.preset).toBe(preset.id);
      await waitRendered(page, f);
      const got = await pixel(page);
      const want = adjustPixel(original, preset.adjust); // 가운데는 비네트 영향이 없다
      const err = Math.max(...got.map((v, i) => Math.abs(v - want[i])));
      expect(err, `${preset.id} @${f}: got ${got} want ${want}`).toBeLessThanOrEqual(3);
      seen.add(`${f}:${got.join(',')}`);
    }
  }
  // 12종이 서로 다른 결과를 낸다 (같은 색이 거의 없다)
  expect(seen.size).toBeGreaterThanOrEqual(20);
});

test('조정 슬라이더 6종: 0이면 원본, 움직이면 바뀌고, 드래그 한 번 = 실행 취소 1개', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4');
  await seekRuler(page, 75); // 파랑
  await page.getByRole('tab', { name: '효과' }).click();
  await waitRendered(page, 75);
  const original = await pixel(page);
  const originalCorner = await pixel(page, 0.03, 0.03);

  const cases: [string, number, (p: number[], c: number[]) => void][] = [
    ['brightness', 50, (p) => expect(p[0] + p[1] + p[2]).toBeGreaterThan(original[0] + original[1] + original[2] + 60)],
    ['contrast', -60, (p) => expect(Math.abs(p[2] - 128)).toBeLessThan(Math.abs(original[2] - 128))],
    ['saturation', -100, (p) => expect(Math.max(...p) - Math.min(...p)).toBeLessThan(8)],
    ['temperature', 80, (p) => expect(p[0]).toBeGreaterThan(original[0] + 10)],
    ['vignette', 100, (_p, c) => expect(c[2]).toBeLessThan(originalCorner[2] - 30)],
  ];
  for (const [key, value, check] of cases) {
    const slider = page.getByTestId(`adjust-${key}`);
    await slider.fill(String(value));
    await waitRendered(page, 75);
    check(await pixel(page), await pixel(page, 0.03, 0.03));
    await slider.fill('0');
    await waitRendered(page, 75);
    const back = await pixel(page);
    expect(Math.max(...back.map((v, i) => Math.abs(v - original[i]))), `${key} 0으로 되돌리면 원본`).toBeLessThanOrEqual(2);
  }
  // 선명도: 단색에서는 변화가 없어야 한다 (가장자리만 날카롭게)
  await page.getByTestId('adjust-sharpness').fill('100');
  await waitRendered(page, 75);
  expect(Math.max(...(await pixel(page)).map((v, i) => Math.abs(v - original[i])))).toBeLessThanOrEqual(3);

  // 프리셋을 고른 뒤 슬라이더를 바꾸면 프리셋 이름은 그대로, 값만 바뀐다
  await page.locator('[data-testid=filter-preset][data-preset-id=warm]').click();
  await page.getByTestId('adjust-brightness').fill('20');
  const f = (await state(page)).edit.tracks[2].clips[0].filter!;
  expect(f.preset).toBe('warm');
  expect(f.adjust.brightness).toBe(20);

  // 실행 취소: 슬라이더 끌기 한 번 = 기록 1개
  const slider = page.getByTestId('adjust-contrast');
  const box = (await slider.boundingBox())!;
  const past0 = (await state(page)).history.past;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 8, box.y + box.height / 2);
  await page.mouse.up();
  expect((await state(page)).history.past).toBe(past0 + 1);
  await page.getByTestId('adjust-reset').click();
  expect((await state(page)).edit.tracks[2].clips[0].filter?.adjust).toEqual({
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    sharpness: 0,
    vignette: 0,
  });
});

test('흐림 채우기: 16:9 영상을 9:16에 넣으면 위아래가 검정 대신 흐린 원본으로 찬다', async ({ page }) => {
  await setup(page, ['pattern.mov']); // 640×360 움직이는 무늬
  await addViaPlus(page, 'pattern.mov');
  await seekRuler(page, 20);
  await waitRendered(page, 20);
  // 기본(단색 검정): 위쪽 빈 곳은 검정
  expect(colorName(await pixel(page, 0.5, 0.12))).toBe('검정');
  const middle = await pixel(page, 0.5, 0.5);

  await page.getByRole('tab', { name: '효과' }).click();
  await page.getByTestId('bg-blur').click();
  await waitRendered(page, 20);
  const top = await pixel(page, 0.5, 0.12);
  expect(top.reduce((a, b) => a + b, 0), '위쪽이 검정이 아니다').toBeGreaterThan(60);
  // 가운데(영상 자체)는 그대로
  expect(Math.max(...(await pixel(page, 0.5, 0.5)).map((v, i) => Math.abs(v - middle[i])))).toBeLessThanOrEqual(3);
  // 위쪽은 흐려서 격자 사이 변화가 작다 (원본 무늬는 변화가 크다)
  const grid = await previewGrid(page, 27, 48);
  const rowVar = (row: number) => {
    let s = 0;
    for (let i = 1; i < 27; i++) for (let c = 0; c < 3; c++) s += Math.abs(grid[(row * 27 + i) * 3 + c] - grid[(row * 27 + i - 1) * 3 + c]);
    return s / 26 / 3;
  };
  expect(rowVar(4), '흐린 배경은 부드럽다').toBeLessThan(rowVar(24) * 0.6);

  // 흐림 정도 0 = 흐리지 않은(꽉 채운) 원본, 100 = 더 흐림
  await page.getByTestId('bg-blur-amount').fill('0');
  await waitRendered(page, 20);
  const sharpVar = rowVar(4);
  await page.getByTestId('bg-blur-amount').fill('100');
  await waitRendered(page, 20);
  const g100 = await previewGrid(page, 27, 48);
  let v100 = 0;
  for (let i = 1; i < 27; i++) for (let c = 0; c < 3; c++) v100 += Math.abs(g100[(4 * 27 + i) * 3 + c] - g100[(4 * 27 + i - 1) * 3 + c]);
  expect(v100 / 26 / 3).toBeLessThanOrEqual(sharpVar);

  // 단색으로 돌아가 색을 바꿀 수 있다
  await page.getByTestId('bg-color').click();
  await page.getByTestId('bg-color-value').fill('#ff0000');
  await waitRendered(page, 20);
  expect(colorName(await pixel(page, 0.5, 0.12))).toBe('빨강');
  // 배경 설정도 저장된다 (실행 취소 기록에도 남는다)
  expect((await state(page)).edit.background).toEqual({ kind: 'color', color: '#ff0000' });
});

test('미리보기 = 내보내기: 필터 + 흐림 배경을 적용한 프레임 3곳의 픽셀이 같다', async ({ page }) => {
  test.setTimeout(240_000);
  await setup(page, ['pattern.mov', 'color-steps.mp4']);
  const bottom = await addViaPlus(page, 'pattern.mov'); // 메인 트랙 0~90 (16:9)
  await page.getByRole('tab', { name: '효과' }).click();
  await clipEl(page, bottom).click();
  await page.locator('[data-testid=filter-preset][data-preset-id=cinema]').click(); // 대비·채도·색온도·비네트
  await page.getByTestId('adjust-sharpness').fill('50');
  await page.getByTestId('bg-blur').click();
  await page.getByTestId('bg-blur-amount').fill('60');
  expect((await state(page)).edit.background).toEqual({ kind: 'blur', amount: 60 });

  const frames = [10, 45, 80];
  const diffs = await previewVsExport(page, frames, 'FILTER_EXPORT');
  test.info().annotations.push({ type: 'filter-export-diff', description: JSON.stringify(diffs) });
  for (let i = 0; i < frames.length; i++) expect(diffs[i], `프레임 ${frames[i]}`).toBeLessThanOrEqual(3);
});

test('필터·배경은 새로고침해도 남는다', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4');
  await page.getByRole('tab', { name: '효과' }).click();
  await page.locator('[data-testid=filter-preset][data-preset-id=vintage]').click();
  await page.getByTestId('bg-blur').click();
  const before = (await state(page)).edit;
  await page.evaluate(() => window.__editor.saveNow());
  await page.reload();
  await page.waitForFunction(() => typeof window.__editor?.state === 'function');
  const after = (await state(page)).edit;
  expect(after.background).toEqual(before.background);
  expect(after.tracks[2].clips[0].filter).toEqual(before.tracks[2].clips[0].filter);
});
