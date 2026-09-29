/** 태스크 3: 미디어 가져오기, 썸네일/필름스트립/파형, 거부 메시지, IndexedDB 저장 */
import { expect, test, type Page } from '@playwright/test';
import { statSync } from 'node:fs';
import '../../src/debug-types';
import { fixture, serveFixtures } from './fixtures';

const SIX = ['color-steps.mp4', 'pattern.mov', 'image.png', 'image.jpg', 'audio.mp3', 'audio.wav'];

const state = (page: Page) => page.evaluate(() => window.__editor.state());
const ready = (page: Page) => page.locator('[data-testid=media-item][data-status=ready]');

async function assetsByName(page: Page) {
  const s = await state(page);
  return Object.fromEntries(Object.values(s.assets).map((a) => [a.name, a]));
}

/** [r,g,b]가 어떤 기본색인지 */
function colorName([r, g, b]: number[]): string {
  const hi = (v: number) => v > 170;
  const lo = (v: number) => v < 90;
  if (hi(r) && lo(g) && lo(b)) return '빨강';
  if (lo(r) && hi(g) && lo(b)) return '초록';
  if (lo(r) && lo(g) && hi(b)) return '파랑';
  if (hi(r) && hi(g) && lo(b)) return '노랑';
  return `기타(${r},${g},${b})`;
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => typeof window.__editor?.media === 'function');
});

test('6가지 형식 가져오기: 메타데이터, 썸네일, 필름스트립, 파형', async ({ page }) => {
  await page.getByTestId('import-input').setInputFiles(SIX.map(fixture));
  await expect(ready(page)).toHaveCount(6, { timeout: 30_000 });

  const a = await assetsByName(page);
  expect(a['color-steps.mp4']).toMatchObject({ kind: 'video', width: 540, height: 960, durationFrames: 120, hasAudio: true });
  expect(a['pattern.mov']).toMatchObject({ kind: 'video', width: 640, height: 360, durationFrames: 90, hasAudio: true });
  expect(a['image.png']).toMatchObject({ kind: 'image', width: 400, height: 400, hasAudio: false });
  expect(a['image.jpg']).toMatchObject({ kind: 'image', width: 600, height: 400, hasAudio: false });
  expect(a['audio.mp3']).toMatchObject({ kind: 'audio', hasAudio: true });
  expect(a['audio.mp3'].durationFrames).toBeGreaterThanOrEqual(150);
  expect(a['audio.mp3'].durationFrames).toBeLessThanOrEqual(152);
  expect(a['audio.wav']).toMatchObject({ kind: 'audio', durationFrames: 90, hasAudio: true });

  // 썸네일: 영상 2 + 이미지 2 = 포스터 4장이 실제로 그려져 있다
  const posters = page.locator('[data-testid=media-item] img');
  await expect(posters).toHaveCount(4);
  for (const img of await posters.all()) {
    expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  }
  // 오디오 2개는 썸네일 자리에 파형
  await expect(page.locator('[data-testid=media-item][data-kind=audio] canvas')).toHaveCount(2);

  // 필름스트립: 4초 영상 → 1초 간격 4장, 초마다 빨강/초록/파랑/노랑
  const cs = a['color-steps.mp4'].id;
  const m = (await page.evaluate((id) => window.__editor.media(id), cs))!;
  expect(m.filmstrip).toMatchObject({ count: 4, interval: 1, thumbH: 56 });
  const px = await page.evaluate((id) => [0, 1, 2, 3].map((i) => window.__editor.filmstripPixel(id, i)!), cs);
  expect(px.map(colorName)).toEqual(['빨강', '초록', '파랑', '노랑']);
  expect((await page.evaluate((id) => window.__editor.media(id), a['pattern.mov'].id))!.filmstrip?.count).toBe(3);

  // 파형: 초당 100개, 실제 소리 크기
  expect(m.peaksLength).toBe(400);
  expect(m.peaksMax).toBeGreaterThan(0.3);
  const mp3 = (await page.evaluate((id) => window.__editor.media(id), a['audio.mp3'].id))!;
  expect(mp3.peaksLength).toBeGreaterThan(500);
  expect(mp3.peaksMax).toBeGreaterThan(0.5);

  await page.screenshot({ path: test.info().outputPath('media.png') });
});

test('끌어다 놓아 가져오기', async ({ page }) => {
  await serveFixtures(page);
  const dt = await page.evaluateHandle(async () => {
    const dt = new DataTransfer();
    for (const n of ['image.png', 'audio.wav']) {
      const b = await (await fetch(`./__fixtures__/${n}`)).blob();
      dt.items.add(new File([b], n, { type: b.type }));
    }
    return dt;
  });
  const zone = page.getByTestId('media-dropzone');
  await zone.dispatchEvent('dragenter', { dataTransfer: dt });
  await zone.dispatchEvent('dragover', { dataTransfer: dt });
  await expect(page.getByTestId('drop-overlay')).toBeVisible();
  await zone.dispatchEvent('drop', { dataTransfer: dt });
  await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
  await expect(ready(page)).toHaveCount(2, { timeout: 20_000 });
  expect(Object.keys(await assetsByName(page)).sort()).toEqual(['audio.wav', 'image.png']);
});

test('미디어 패널 밖에 파일을 놓아도 페이지가 바뀌지 않고 가져온다', async ({ page }) => {
  await serveFixtures(page);
  const dt = await page.evaluateHandle(async () => {
    const dt = new DataTransfer();
    const b = await (await fetch('./__fixtures__/image.jpg')).blob();
    dt.items.add(new File([b], 'image.jpg', { type: b.type }));
    return dt;
  });
  const url = page.url();
  const target = page.getByTestId('timeline');
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await target.dispatchEvent('drop', { dataTransfer: dt });
  await expect(ready(page)).toHaveCount(1, { timeout: 20_000 });
  expect(page.url()).toBe(url);
});

test('가져올 수 없는 파일은 이름과 이유를 알려 주고 거부한다 (R4.4)', async ({ page }) => {
  await page.getByTestId('import-input').setInputFiles([
    { name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('이건 영상이 아닙니다') },
    { name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
    { name: 'empty.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(0) },
    { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('png 아님') },
  ]);
  const toasts = page.getByTestId('toast');
  await expect(toasts).toHaveCount(4);
  await expect(toasts.nth(0)).toContainText('broken.mp4: 파일이 손상되었거나 읽을 수 없는 형식입니다.');
  await expect(toasts.nth(1)).toContainText('anim.gif: 지원하지 않는 형식입니다.');
  await expect(toasts.nth(2)).toContainText('empty.wav: 빈 파일입니다.');
  await expect(toasts.nth(3)).toContainText('fake.png: 파일이 손상되었거나');
  expect(Object.keys((await state(page)).assets)).toHaveLength(0);
  await expect(page.getByTestId('media-item')).toHaveCount(0);
});

test('HEVC 영상: 이 브라우저가 디코딩하지 못하면 코덱 이름과 함께 거부', async ({ page }) => {
  const hevc = await page.evaluate(async () => (await VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L60.90' })).supported === true);
  test.info().annotations.push({ type: 'hevc-decode', description: String(hevc) });
  await page.getByTestId('import-input').setInputFiles(fixture('hevc.mp4'));
  if (hevc) {
    await expect(ready(page)).toHaveCount(1, { timeout: 20_000 });
  } else {
    await expect(page.getByTestId('toast')).toContainText('hevc.mp4: 이 브라우저에서 재생할 수 없는 영상 코덱(HEVC(H.265))입니다.');
    await expect(page.getByTestId('media-item')).toHaveCount(0);
  }
});

test('가져온 원본과 파생 데이터는 IndexedDB에 저장되어 새로고침 뒤에도 남는다 (R10.2)', async ({ page }) => {
  await page.getByTestId('import-input').setInputFiles(SIX.map(fixture));
  await expect(ready(page)).toHaveCount(6, { timeout: 30_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__editor.stored())).media.length).toBe(6);
  await expect.poll(async () => (await page.evaluate(() => window.__editor.stored())).derivedKeys.length).toBe(10);

  await page.reload();
  await page.waitForFunction(() => typeof window.__editor?.stored === 'function');
  const stored = await page.evaluate(() => window.__editor.stored());
  const got = stored.media.map((m) => `${m.name}:${m.size}`).sort();
  expect(got).toEqual(SIX.map((n) => `${n}:${statSync(fixture(n)).size}`).sort());
  const kinds = stored.derivedKeys.map((k) => k.split(':')[1]).sort();
  // 포스터 4(영상 2, 이미지 2) + 필름스트립 2(영상) + 파형 4(영상 2, 오디오 2)
  expect(kinds).toEqual([...Array(2).fill('filmstrip'), ...Array(4).fill('peaks'), ...Array(4).fill('poster')]);
});
