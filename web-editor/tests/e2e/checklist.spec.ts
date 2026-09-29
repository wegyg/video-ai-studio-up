/**
 * 확인 2 체크리스트 1번·3번(미리보기 쪽)을 숫자로 확인한다.
 * 1) 한글 텍스트를 넣고, 프리셋과 등장 애니메이션을 바꾸면 바로 반영되는가?
 *    → 누른 순간부터 미리보기 화면이 실제로 바뀔 때까지 걸린 시간을 잰다.
 * 3) BGM 볼륨과 페이드가 귀로 들리게 적용되는가?
 *    → 스피커로 나가는 소리 크기(출력 RMS)를 재서 볼륨 비율과 페이드를 확인한다.
 * (2번은 inspector.spec, 4번은 persist.spec, 5·6번은 acceptance.spec·phone.spec)
 */
import { expect, test, type Page } from '@playwright/test';
import { addViaPlus, lanes, seekRuler, setup, state, tile } from './helpers';

/** 행동을 한 순간부터 미리보기 캔버스 내용이 바뀔 때까지(ms) */
async function repaintLatency(page: Page, act: () => Promise<void>): Promise<number> {
  await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const ctx = c.getContext('2d')!;
    const sig = () => {
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 13) h = (h * 31 + d[i]) | 0;
      return h;
    };
    const w = window as unknown as { __probe: { base: number; t0: number; t1: number } };
    w.__probe = { base: sig(), t0: 0, t1: 0 };
    const probe = w.__probe;
    const arm = () => {
      if (!probe.t0) probe.t0 = performance.now();
    };
    for (const type of ['pointerdown', 'keydown', 'input', 'change']) document.addEventListener(type, arm, { capture: true, once: true });
    const loop = () => {
      if (probe.t0 && sig() !== probe.base) probe.t1 = performance.now();
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await act();
  await page.waitForFunction(() => (window as unknown as { __probe: { t1: number } }).__probe.t1 > 0, null, { timeout: 5000 });
  return page.evaluate(() => {
    const p = (window as unknown as { __probe: { t0: number; t1: number } }).__probe;
    return Math.round(p.t1 - p.t0);
  });
}

const textClip = async (page: Page) => (await state(page)).edit.tracks[0].clips[0];

test('1) 한글 텍스트·프리셋·등장 애니메이션이 누르자마자 미리보기에 보인다', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4');
  // 글꼴 6개(Pretendard·Noto Sans KR × 3굵기)를 미리 불러 둔다 — 사용자가 프리셋을 누르기 전에 끝나 있다
  await page.waitForFunction(() => [...document.fonts].filter((f) => f.status === 'loaded').length >= 6, null, { timeout: 15_000 });
  await seekRuler(page, 15);
  await page.getByRole('tab', { name: '텍스트' }).click();

  // 텍스트 추가: 기본 애니메이션이 없으므로 그 자리에서 바로 보인다
  const addMs = await repaintLatency(page, () => page.getByTestId('add-text').click());

  // 한글을 치는 동안(칸을 벗어나기 전에도) 바로 반영, 다 치고 나면 실행 취소 기록은 1개
  const box = page.getByTestId('text-content');
  await box.click();
  await box.press('Control+a');
  const past0 = (await state(page)).history.past;
  const typeMs = await repaintLatency(page, () => box.pressSequentially('한글 자막 입력 확인', { delay: 25 }));
  expect((await textClip(page)).text).toBe('한글 자막 입력 확인'); // 아직 칸 안에 있는데도 반영됨
  await box.blur();
  expect((await state(page)).history.past).toBe(past0 + 1);

  // 프리셋: 다른 글꼴(Noto Sans KR 900)로 바뀌는 프리셋도 기다림 없이
  const presetMs = await repaintLatency(page, () =>
    page.locator('[data-testid=text-preset][data-preset-id="shorts-highlight"]').click(),
  );

  // 등장 애니메이션: 고르면 그 부분을 한 번 재생해 보여 주고, 원래 보던 곳으로 돌아온다
  const clip = await textClip(page);
  await seekRuler(page, clip.start + 45);
  const animMs = await repaintLatency(page, async () => {
    await page.getByTestId('anim-in').selectOption('pop');
  });
  await expect.poll(async () => (await state(page)).ui.playing, { timeout: 1000 }).toBe(true);
  await expect.poll(async () => (await state(page)).ui.playing, { timeout: 5000 }).toBe(false);
  expect((await state(page)).ui.playhead).toBe(clip.start + 45);

  const report = { 텍스트추가_ms: addMs, 한글입력_ms: typeMs, 프리셋_ms: presetMs, 애니메이션_ms: animMs };
  test.info().annotations.push({ type: 'latency', description: JSON.stringify(report) });
  console.log('LATENCY ' + JSON.stringify(report));
  // "바로" = 한 번 깜빡이는 시간(0.2초) 안. 완료 기준 G1은 1초
  for (const [k, v] of Object.entries(report)) expect(v, k).toBeLessThan(200);
});

/** 재생하면서 스피커로 나가는 소리 크기를 여러 번 재 평균 낸다 */
async function playAndMeasure(page: Page, fromFrame: number, skipMs: number, measureMs: number): Promise<number> {
  await seekRuler(page, fromFrame);
  await page.keyboard.press('Space');
  await page.waitForTimeout(skipMs);
  const levels: number[] = [];
  const end = Date.now() + measureMs;
  while (Date.now() < end) {
    levels.push((await page.evaluate(() => window.__editor.preview()))!.level);
    await page.waitForTimeout(40);
  }
  await page.keyboard.press('Space');
  return levels.reduce((a, b) => a + b, 0) / levels.length;
}

test('3) BGM 볼륨과 페이드가 실제로 나오는 소리 크기에 반영된다 (미리보기)', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page, ['audio.wav']); // 3초, 660Hz
  await tile(page, 'audio.wav').dragTo(lanes(page, 'audio').first(), { targetPosition: { x: 4, y: 20 } });

  // 볼륨 100% vs 30%: 같은 구간(1.0~2.0초)을 재생해 비교
  const full = await playAndMeasure(page, 30, 250, 800);
  await page.getByTestId('prop-volume').fill('30');
  const low = await playAndMeasure(page, 30, 250, 800);

  // 페이드 인 1초: 처음 0.3초는 작고, 1.3초 뒤에는 원래 크기
  await page.getByTestId('prop-volume').fill('100');
  await page.getByTestId('prop-fade-in').fill('1');
  await page.getByTestId('prop-fade-in').press('Enter');
  const early = await playAndMeasure(page, 0, 60, 220);
  const late = await playAndMeasure(page, 40, 250, 500);

  const report = {
    '100%': Number(full.toFixed(4)),
    '30%': Number(low.toFixed(4)),
    '비율(기대 0.3)': Number((low / full).toFixed(3)),
    페이드_처음: Number(early.toFixed(4)),
    페이드_뒤: Number(late.toFixed(4)),
  };
  test.info().annotations.push({ type: 'audible', description: JSON.stringify(report) });
  console.log('AUDIBLE ' + JSON.stringify(report));
  expect(full).toBeGreaterThan(0.05); // 실제로 소리가 난다
  expect(low / full).toBeGreaterThan(0.2);
  expect(low / full).toBeLessThan(0.4);
  expect(early).toBeLessThan(late * 0.5); // 페이드 인 구간은 뚜렷이 작다
});
