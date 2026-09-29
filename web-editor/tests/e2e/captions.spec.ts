/**
 * 3단계 1번: 자동 자막 (R20) — 자막 클립 만들기·수정·실행 취소·저장.
 * 인식 모델은 여기서 쓰지 않는다(수백 MB를 매번 받지 않도록). 실제 모델 검증은 `captions-model.spec.ts`.
 */
import { expect, test, type Page } from '@playwright/test';
import { addViaPlus, clipEl, lanes, seekRuler, setup, state, waitRendered } from './helpers';

const WORDS = [
  { text: '안녕하세요', start: 0.0, end: 0.6 },
  { text: '오늘은', start: 0.7, end: 1.1 },
  { text: '카페를', start: 1.15, end: 1.6 },
  { text: '소개합니다.', start: 1.65, end: 2.4 },
  { text: '분위기가', start: 3.2, end: 3.7 },
  { text: '좋아요', start: 3.75, end: 4.2 },
];

const textClips = async (page: Page) => (await state(page)).edit.tracks.filter((t) => t.kind === 'text').flatMap((t) => t.clips);
const make = (page: Page, style: 'line' | 'word') => page.evaluate(([w, s]) => window.__editor.captionsFromWords(w as typeof WORDS, s as 'line' | 'word'), [WORDS, style] as const);

test.beforeEach(async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4'); // 0~120 (4초)
});

test('자막 탭: 소리·모양·정확도를 고를 수 있고, 모델 크기와 한 번만 받는다는 안내가 보인다', async ({ page }) => {
  await page.getByRole('tab', { name: '자막' }).click();
  await expect(page.getByTestId('captions-panel')).toContainText('브라우저 안에서 처리');
  await expect(page.getByTestId('captions-source-all')).toHaveAttribute('aria-checked', 'true');
  // 방금 넣은 영상(소리 있음)이 선택된 상태라 "고른 클립"을 쓸 수 있다
  await expect(page.getByTestId('captions-source-clip')).toBeEnabled();
  await expect(page.getByTestId('captions-style-line')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('captions-model-normal')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('captions-panel')).toContainText('처음 한 번 내려받는 크기');
  await expect(page.getByTestId('captions-start')).toBeEnabled();

  // 선택을 풀면 잠긴다 (빈 트랙을 눌러 선택 해제)
  await lanes(page, 'text').first().click({ position: { x: 400, y: 10 } });
  expect((await state(page)).ui.selectedClipId).toBeNull();
  await expect(page.getByTestId('captions-source-clip')).toBeDisabled();
});

test('문장 자막: 인식 결과가 텍스트 클립이 되고, 글자를 바로 고칠 수 있다 · 실행 취소 1번 · 새로고침 유지', async ({ page }) => {
  const past = (await state(page)).history.past;
  expect(await make(page, 'line')).toBe(3);
  const clips = await textClips(page);
  expect(clips.map((c) => [c.text, c.start, c.duration])).toEqual([
    ['안녕하세요 오늘은 카페를', 0, 48],
    ['소개합니다.', 50, 22],
    ['분위기가 좋아요', 96, 30],
  ]);
  expect(clips[0].stroke?.width).toBeGreaterThan(0); // 쇼츠 자막 프리셋(외곽선)이 적용됐다
  expect(clips[0].animIn?.type).toBe('none');
  expect((await state(page)).history.past).toBe(past + 1);

  // 화면에 실제로 보인다
  await seekRuler(page, 10);
  await waitRendered(page, 10);
  const lit = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    // 자막은 화면 가운데에 그려진다 (기본 배치)
    const d = c.getContext('2d')!.getImageData(0, Math.floor(c.height * 0.4), c.width, Math.floor(c.height * 0.2)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++;
    return n;
  });
  expect(lit, '흰 자막 글자가 보인다').toBeGreaterThan(200);

  // 보통 텍스트 클립이라 글자를 고칠 수 있다
  await clipEl(page, clips[1].id).click();
  await page.getByTestId('text-content').fill('카페를 소개합니다');
  await page.getByTestId('text-content').blur();
  expect((await textClips(page))[1].text).toBe('카페를 소개합니다');

  await page.keyboard.press('Control+z'); // 글자 고치기 취소
  await page.keyboard.press('Control+z'); // 자막 만들기 취소 (한 번)
  expect(await textClips(page)).toHaveLength(0);
  await page.keyboard.press('Control+y');
  expect(await textClips(page)).toHaveLength(3);

  await page.evaluate(() => window.__editor.saveNow());
  await page.reload();
  await page.waitForFunction(() => typeof window.__editor?.state === 'function');
  await expect.poll(async () => (await textClips(page)).length).toBe(3);
});

test('단어 강조: 단어마다 클립이 생기고 톡 나타난다 · 자리가 없으면 새 텍스트 트랙에 넣는다', async ({ page }) => {
  expect(await make(page, 'word')).toBe(6);
  let clips = await textClips(page);
  expect(clips.map((c) => c.text)).toEqual(WORDS.map((w) => w.text));
  expect(clips[0].animIn?.type).toBe('pop');
  for (let i = 0; i < clips.length - 1; i++) expect(clips[i].start + clips[i].duration).toBeLessThanOrEqual(clips[i + 1].start);
  const tracks0 = (await state(page)).edit.tracks.filter((t) => t.kind === 'text').length;

  // 같은 구간에 또 만들면 새 트랙에 (앞 자막을 밀어내지 않는다)
  expect(await make(page, 'line')).toBe(3);
  const tracks1 = (await state(page)).edit.tracks.filter((t) => t.kind === 'text').length;
  expect(tracks1).toBe(tracks0 + 1);
  clips = await textClips(page);
  expect(clips).toHaveLength(9);
  expect(clips.filter((c) => c.text === '안녕하세요')).toHaveLength(1); // 단어 강조 쪽 그대로
});
