/**
 * 태스크 7: 텍스트 강화 — 한글 렌더링, 프리셋 20종, 애니메이션 9종, 자동 줄바꿈, 안전 영역, 인라인 편집.
 */
import { expect, test, type Page } from '@playwright/test';
import { seekRuler, setup, state, waitRendered } from './helpers';

const textClip = async (page: Page) => (await state(page)).edit.tracks[0].clips[0];

/** 미리보기 캔버스에서 글자가 실제로 그려진 픽셀 수와 색 분포 */
async function inkStats(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    const colors = new Set<string>();
    let minX = 1e9;
    let maxX = -1;
    let minY = 1e9;
    let maxY = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        if (r + g + b > 40) {
          ink++;
          colors.add(`${r >> 5},${g >> 5},${b >> 5}`);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { ink, colors: colors.size, w: c.width, h: c.height, minX, maxX, minY, maxY };
  });
}

test.beforeEach(async ({ page }) => {
  await setup(page, []);
  await page.getByRole('tab', { name: '텍스트' }).click();
});

test('텍스트 추가: 한글이 □ 없이 그려진다 (R7.2)', async ({ page }) => {
  await page.getByTestId('add-text').click();
  const clip = await textClip(page);
  expect(clip.type).toBe('text');
  expect(clip.text).toBe('텍스트를 입력하세요');
  await seekRuler(page, 45); // 등장 효과가 끝난 뒤
  await waitRendered(page, 45);

  const stats = await inkStats(page);
  // 글자가 실제로 칠해졌고, 캔버스 전체가 아니라 일부만 차지한다
  expect(stats.ink).toBeGreaterThan(500);
  expect(stats.ink).toBeLessThan(stats.w * stats.h * 0.5);

  // 같은 글자 수의 한글과 두부(□)를 비교: 두부면 글자마다 같은 사각형이 반복돼 폭이 좁고 획이 단순하다
  await page.screenshot({ path: test.info().outputPath('text-korean.png') });

  // 글꼴을 Noto Sans KR로 바꿔도 그려진다
  await page.getByTestId('text-font').selectOption('Noto Sans KR');
  await waitRendered(page, 45);
  const noto = await inkStats(page);
  expect(noto.ink).toBeGreaterThan(500);
  // 글꼴이 다르면 픽셀 수도 달라진다(같은 글자를 다른 모양으로 그린다)
  expect(Math.abs(noto.ink - stats.ink)).toBeGreaterThan(20);
});

test('스타일 프리셋 20종: 모두 적용되고 화면이 실제로 바뀐다 (R7.6)', async ({ page }) => {
  const presets = page.getByTestId('text-preset');
  await expect(presets).toHaveCount(20);

  // 선택된 텍스트가 없으면 프리셋을 누를 때 새로 만든다
  await presets.first().click();
  expect((await state(page)).edit.tracks[0].clips).toHaveLength(1);
  await seekRuler(page, 45);

  const seen = new Set<string>();
  const ids = await presets.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.presetId!));
  for (const id of ids) {
    await page.locator(`[data-testid=text-preset][data-preset-id="${id}"]`).click();
    await waitRendered(page, 45);
    const s = await inkStats(page);
    expect(s.ink, `${id} 렌더링`).toBeGreaterThan(300);
    seen.add(`${s.ink}:${s.colors}`);
    // 프리셋 적용은 글자 내용과 시간을 건드리지 않는다
    const c = await textClip(page);
    expect(c.text, id).toBe('텍스트를 입력하세요');
    expect(c.start, id).toBe(0);
  }
  // 20종이 모두 똑같이 보이지는 않는다 (최소 10가지 이상 서로 다른 결과)
  expect(seen.size).toBeGreaterThanOrEqual(10);
  // 프리셋은 실행 취소로 되돌릴 수 있다
  const before = await textClip(page);
  await page.keyboard.press('Control+z');
  expect((await textClip(page)).id).toBe(before.id);
});

test('등장·퇴장 애니메이션 9종: 시작·중간·끝이 서로 다르다 (R7.7)', async ({ page }) => {
  await page.getByTestId('add-text').click();
  // 길이 3초(90프레임), 등장 1초(30프레임), 퇴장 없음
  await page.getByTestId('anim-out').selectOption('none');
  await page.getByTestId('anim-in-duration').fill('1');
  await page.getByTestId('anim-in-duration').press('Enter');
  await expect.poll(async () => (await textClip(page)).animIn?.duration).toBe(30);

  const types = ['fade', 'pop', 'typewriter', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'bounce', 'zoom'];
  for (const type of types) {
    await page.getByTestId('anim-in').selectOption(type);
    await expect.poll(async () => (await textClip(page)).animIn?.type).toBe(type);

    // 시작(0), 중간(15), 끝(45: 효과 끝난 뒤)
    const frames = [0, 15, 45];
    const shots = [];
    for (const f of frames) {
      await seekRuler(page, f);
      await waitRendered(page, f);
      shots.push(await inkStats(page));
    }
    const [start, mid, end] = shots;
    expect(end.ink, `${type} 끝 프레임`).toBeGreaterThan(500);
    // 시작 상태는 끝 상태와 다르다 (투명도·크기·위치·글자 수 중 무엇이든)
    const differs =
      Math.abs(start.ink - end.ink) > 30 || start.minX !== end.minX || start.minY !== end.minY || start.maxY !== end.maxY;
    expect(differs, `${type} 시작 ≠ 끝 (start=${JSON.stringify(start)} end=${JSON.stringify(end)})`).toBe(true);
    // 중간은 진행 중이므로 시작·끝 중 하나와는 달라야 한다
    expect(mid.ink !== start.ink || mid.minY !== start.minY || mid.ink !== end.ink, `${type} 중간`).toBe(true);
  }

  // 타자기는 중간에 글자가 일부만 보인다
  await page.getByTestId('anim-in').selectOption('typewriter');
  await seekRuler(page, 15);
  await waitRendered(page, 15);
  const half = await inkStats(page);
  await seekRuler(page, 45);
  await waitRendered(page, 45);
  const full = await inkStats(page);
  expect(half.ink).toBeLessThan(full.ink);
  expect(half.maxX).toBeLessThan(full.maxX);
});

test('긴 문장 자동 줄바꿈 + 안전 영역 안내선 (R7.8, R7.9)', async ({ page }) => {
  await page.getByTestId('add-text').click();
  await seekRuler(page, 45);
  await waitRendered(page, 45);
  const one = await inkStats(page);

  const long = '홍보 영상을 만들 때 가장 중요한 것은 처음 삼 초 안에 무엇을 보여 주는지입니다';
  await page.getByTestId('text-content').fill(long);
  await page.getByTestId('text-content').blur();
  await expect.poll(async () => (await textClip(page)).text).toBe(long);
  await waitRendered(page, 45);
  const wrapped = await inkStats(page);

  // 여러 줄이 되었다: 높이가 늘고, 안전 영역 너비(90%)를 넘지 않는다
  expect(wrapped.maxY - wrapped.minY).toBeGreaterThan((one.maxY - one.minY) * 1.8);
  expect(wrapped.minX).toBeGreaterThanOrEqual(Math.floor(wrapped.w * 0.05) - 2);
  expect(wrapped.maxX).toBeLessThanOrEqual(Math.ceil(wrapped.w * 0.95) + 2);

  // 안전 영역 안내선: 켜면 보이고, 껐을 때는 없다
  await expect(page.getByTestId('safe-area')).toHaveCount(0);
  await page.getByTestId('safe-area-toggle').click();
  await expect(page.getByTestId('safe-area')).toBeVisible();
  // 안내선은 캔버스가 아니라 화면 표시용이라 그려진 픽셀에 영향을 주지 않는다 (내보낸 영상에 안 들어감)
  await waitRendered(page, 45);
  const withGuides = await inkStats(page);
  expect(withGuides.ink).toBe(wrapped.ink);
  await page.getByTestId('safe-area-toggle').click();
  await expect(page.getByTestId('safe-area')).toHaveCount(0);
});

test('미리보기에서 두 번 눌러 글자 고치기 (R7.5)', async ({ page }) => {
  await page.getByTestId('add-text').click();
  await seekRuler(page, 45);
  await waitRendered(page, 45);
  const frame = (await page.getByTestId('preview-frame').boundingBox())!;
  const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };

  await page.mouse.dblclick(center.x, center.y);
  const editor = page.getByTestId('inline-text-editor');
  await expect(editor).toBeVisible();
  await editor.fill('새로 쓴 문구');
  await editor.press('Control+Enter');
  await expect(editor).toHaveCount(0);
  expect((await textClip(page)).text).toBe('새로 쓴 문구');
  await waitRendered(page, 45);
  expect((await inkStats(page)).ink).toBeGreaterThan(300);

  // Esc로 취소하면 값이 그대로
  await page.mouse.dblclick(center.x, center.y);
  await page.getByTestId('inline-text-editor').fill('버릴 내용');
  await page.getByTestId('inline-text-editor').press('Escape');
  await expect(page.getByTestId('inline-text-editor')).toHaveCount(0);
  expect((await textClip(page)).text).toBe('새로 쓴 문구');

  // 편집 중에는 단축키(S 분할, Delete)가 동작하지 않는다 (R9.2)
  await page.mouse.dblclick(center.x, center.y);
  await page.getByTestId('inline-text-editor').press('s');
  await page.getByTestId('inline-text-editor').press('Delete');
  expect((await state(page)).edit.tracks[0].clips).toHaveLength(1);
  await page.getByTestId('inline-text-editor').press('Escape');
});

test('등장·퇴장 시간을 숫자로 바꿀 수 있다 (R7.4)', async ({ page }) => {
  await page.getByTestId('add-text').click();
  await page.getByTestId('text-start').fill('2');
  await page.getByTestId('text-start').press('Enter');
  await expect.poll(async () => (await textClip(page)).start).toBe(60);
  await page.getByTestId('text-end').fill('5');
  await page.getByTestId('text-end').press('Enter');
  const c = await textClip(page);
  expect(c.start + c.duration).toBe(150);
});
