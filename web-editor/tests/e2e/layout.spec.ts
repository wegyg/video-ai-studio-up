/** 태스크 2: 레이아웃, 비율 전환, 단축키, 한국어 UI */
import { expect, test, type Page } from '@playwright/test';
import '../../src/debug-types';
import { fixture } from './fixtures';

const state = (page: Page) => page.evaluate(() => window.__editor.state());

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => typeof window.__editor?.state === 'function');
});

test('레이아웃: 좌측 탭 4개, 미리보기, 속성, 타임라인(텍스트 1, 영상 2, 오디오 1)', async ({ page }) => {
  for (const name of ['미디어', '텍스트', '오디오', '효과']) await expect(page.getByRole('tab', { name })).toBeVisible();
  await expect(page.getByTestId('preview-canvas')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('속성');
  const kinds = await page.getByTestId('track-lane').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kind));
  expect(kinds).toEqual(['text', 'video', 'video', 'audio']);
  await expect(page.getByTestId('playhead')).toBeVisible();
  await expect(page.getByRole('slider', { name: '줌' })).toBeVisible();
  await expect(page.getByRole('button', { name: '자석' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('time-current')).toHaveText('00:00.00');
  await expect(page.getByTestId('time-total')).toHaveText('00:00.00');
  await page.screenshot({ path: test.info().outputPath('layout.png') });

  // toBeVisible()은 화면 밖에 있어도 통과하므로, 주요 영역이 실제로 화면 안에 있는지 확인한다
  const vp = page.viewportSize()!;
  const inside = [
    page.getByTestId('left-panel'),
    page.getByTestId('preview-frame'),
    page.getByTestId('inspector'),
    page.getByTestId('timeline'),
    page.getByRole('slider', { name: '줌' }),
    page.getByRole('button', { name: '자석' }),
    page.getByTestId('redo'),
  ];
  for (const loc of inside) {
    const b = (await loc.boundingBox())!;
    expect(b, await loc.evaluate((e) => e.outerHTML.slice(0, 80))).toBeTruthy();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
  }
  // 문서가 가로로 넘치지 않는다
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
  // 좌측 · 미리보기 · 우측 순서로 나란히 있다
  const [l, p, r] = await Promise.all(
    ['left-panel', 'preview-frame', 'inspector'].map(async (id) => (await page.getByTestId(id).boundingBox())!),
  );
  expect(l.x + l.width).toBeLessThanOrEqual(p.x);
  expect(p.x + p.width).toBeLessThanOrEqual(r.x);

  await page.getByRole('tab', { name: '효과' }).click();
  await expect(page.getByRole('tab', { name: '효과' })).toHaveAttribute('aria-selected', 'true');
  // 2단계 2-1부터 효과 탭에 캔버스 배경과 필터가 있다. 클립을 고르지 않았으면 무엇을 해야 하는지 안내한다 (G1)
  await expect(page.getByTestId('effects-panel')).toContainText('캔버스 배경');
  await expect(page.getByTestId('filter-hint')).toContainText('클립을 먼저 고르세요');
});

test('프로그램 제목과 개발자 표기가 보인다', async ({ page }) => {
  await expect(page).toHaveTitle(/웹 영상 편집기.*몸의중심 이성진.*1877-7323/);
  const credit = page.getByTestId('credit');
  await expect(credit).toBeVisible();
  await expect(credit).toContainText('개발: 몸의중심 이성진');
  await expect(credit.getByRole('link')).toHaveAttribute('href', 'tel:1877-7323');
});

test('비율 전환: 9:16 → 16:9 → 1:1', async ({ page }) => {
  const frame = page.getByTestId('preview-frame');
  const ratio = async () => {
    const b = (await frame.boundingBox())!;
    return b.width / b.height;
  };
  await expect(frame).toHaveAttribute('data-ratio', '9:16');
  await expect.poll(ratio).toBeCloseTo(9 / 16, 2);
  await page.getByRole('radio', { name: '가로 16:9' }).click();
  await expect(frame).toHaveAttribute('data-ratio', '16:9');
  await expect.poll(ratio).toBeCloseTo(16 / 9, 1);
  await page.getByRole('radio', { name: '정사각 1:1' }).click();
  await expect.poll(ratio).toBeCloseTo(1, 2);
  expect((await state(page)).edit.ratio).toBe('1:1');
});

/** 빈 타임라인은 재생되지 않으므로(태스크 5) 재생 관련 테스트는 이미지 클립 하나를 넣고 시작한다 */
async function withClip(page: Page) {
  await page.getByTestId('import-input').setInputFiles(fixture('image.png'));
  await expect(page.locator('[data-testid=media-item][data-status=ready]')).toHaveCount(1);
  await page.getByTestId('add-to-timeline').click();
  await page.locator('body').click({ position: { x: 700, y: 300 } }); // 포커스를 버튼 밖으로
}

test('빈 타임라인은 재생되지 않는다', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).ui.playing).toBe(false);
});

test('단축키: 스페이스바 재생/정지, ←/→ 1프레임, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z', async ({ page }) => {
  await withClip(page);
  await page.keyboard.press('Space');
  expect((await state(page)).ui.playing).toBe(true);
  await page.keyboard.press('Space');
  expect((await state(page)).ui.playing).toBe(false);

  await page.getByTestId('ruler').click({ position: { x: 0, y: 10 } }); // 재생으로 움직인 플레이헤드를 0으로
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('time-current')).toHaveText('00:00.02');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('time-current')).toHaveText('00:00.01');

  const frame = page.getByTestId('preview-frame');
  await page.getByRole('radio', { name: '가로 16:9' }).click();
  await page.keyboard.press('Control+z');
  await expect(frame).toHaveAttribute('data-ratio', '9:16');
  await page.keyboard.press('Control+y');
  await expect(frame).toHaveAttribute('data-ratio', '16:9');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(frame).toHaveAttribute('data-ratio', '16:9');
  // 실행 취소 버튼도 같은 동작
  await page.getByTestId('undo').click();
  await expect(frame).toHaveAttribute('data-ratio', '9:16');
});

test('버튼에 포커스가 있어도 스페이스바는 한 번만 재생/정지', async ({ page }) => {
  await withClip(page);
  await page.getByTestId('play').click();
  expect((await state(page)).ui.playing).toBe(true);
  await page.keyboard.press('Space'); // 포커스된 재생 버튼이 다시 눌리면 두 번 토글되어 true로 남는다
  expect((await state(page)).ui.playing).toBe(false);
});

test('입력 칸에 포커스가 있으면 단축키가 동작하지 않는다 (R9.2)', async ({ page }) => {
  const input = page.getByRole('textbox', { name: '프로젝트 이름' });
  await input.click();
  await input.press('End');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('KeyS');
  const s = await state(page);
  expect(s.ui.playing).toBe(false);
  expect(s.ui.playhead).toBe(0);
  await expect(input).toHaveValue('제목 없는 프로젝트 s');
});

/** 화면 글자와 툴팁에서 영어 단어를 찾는다. 파일 형식, 키 이름 같은 기술 표기는 허용한다. */
const ALLOWED = new Set(['mp4', 'mov', 'jpg', 'png', 'mp3', 'wav', 'Ctrl+Z', 'Ctrl+Y', 'Delete']);

async function englishWords(page: Page): Promise<string[]> {
  const texts = await page.evaluate(() => {
    const out = [document.body.innerText];
    for (const el of document.querySelectorAll('[title], [aria-label], [placeholder], [alt]')) {
      for (const a of ['title', 'aria-label', 'placeholder', 'alt']) {
        const v = el.getAttribute(a);
        if (v) out.push(v);
      }
    }
    return out;
  });
  const words = texts.join('\n').match(/[A-Za-z][A-Za-z0-9.+]*/g) ?? [];
  return [...new Set(words)].filter((w) => w.length > 1 && !ALLOWED.has(w));
}

test('화면에 영어 UI 문자열이 없다 (R2.1)', async ({ page }) => {
  for (const tab of ['미디어', '텍스트', '오디오', '효과']) {
    await page.getByRole('tab', { name: tab }).click();
    expect(await englishWords(page), `${tab} 탭`).toEqual([]);
  }
});
