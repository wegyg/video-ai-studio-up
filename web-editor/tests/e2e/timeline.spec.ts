/** 태스크 4: 타임라인 편집 — 끌어 넣기, 이동, 트림, 분할, 삭제, 스냅, 겹침, 줌, 실행 취소 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import '../../src/debug-types';
import type { DebugState } from '../../src/debug-types';
import { fixture } from './fixtures';
import { colorName } from './helpers';

type ClipData = DebugState['edit']['tracks'][number]['clips'][number];

const state = (page: Page) => page.evaluate(() => window.__editor.state());
const lanes = (page: Page, kind: string) => page.locator(`[data-testid=track-lane][data-kind=${kind}]`);
/** 메인 영상 트랙(영상 1) = 맨 아래 영상 트랙 */
const mainLane = (page: Page) => lanes(page, 'video').last();
const tile = (page: Page, name: string) => page.locator(`[data-testid=media-item][title="${name}"]`);
const clipEl = (page: Page, id: string) => page.locator(`[data-testid=clip][data-clip-id="${id}"]`);

/** 트랙별 클립 [종류, start, duration, inPoint] */
async function clipsOf(page: Page, kind: string, index = -1): Promise<ClipData[]> {
  const s = await state(page);
  const ts = s.edit.tracks.filter((t) => t.kind === kind);
  return (index < 0 ? ts[ts.length + index] : ts[index]).clips;
}
async function allClips(page: Page): Promise<ClipData[]> {
  return (await state(page)).edit.tracks.flatMap((t) => t.clips);
}

async function setup(page: Page, files: string[]) {
  await page.goto('./');
  await page.waitForFunction(() => typeof window.__editor?.state === 'function');
  await page.getByTestId('import-input').setInputFiles(files.map(fixture));
  await expect(page.locator('[data-testid=media-item][data-status=ready]')).toHaveCount(files.length, { timeout: 30_000 });
}

async function addViaPlus(page: Page, name: string): Promise<string> {
  const before = new Set((await allClips(page)).map((c) => c.id));
  await tile(page, name).getByTestId('add-to-timeline').click();
  const added = (await allClips(page)).find((c) => !before.has(c.id));
  expect(added, `${name} 추가`).toBeTruthy();
  return added!.id;
}

/** 요소 가운데를 잡고 (dx, dy)만큼 끈다. midway는 놓기 직전에 실행 */
async function drag(page: Page, target: Locator, dx: number, dy = 0, midway?: () => Promise<void>) {
  const b = (await target.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  if (midway) await midway();
  await page.mouse.up();
}

test('미디어를 트랙으로 끌어 넣기 — 종류가 다른 트랙에는 놓을 수 없다 (R4.5)', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'audio.wav', 'image.png']);
  // x=6px → 3프레임 → 스냅(0에서 4프레임 이내)으로 0
  await tile(page, 'color-steps.mp4').dragTo(mainLane(page), { targetPosition: { x: 6, y: 30 } });
  expect((await clipsOf(page, 'video')).map((c) => [c.type, c.start, c.duration])).toEqual([['video', 0, 120]]);
  const canvas = page.locator('[data-testid=clip][data-type=video] canvas');
  await expect(canvas).toHaveCount(1);
  // 소리가 있는 영상 클립: 위쪽은 필름스트립(첫 장 = 빨강), 아래 띠는 파형 (R4.3)
  const px = await canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return { film: at(10, Math.floor(c.height * 0.3)), wave: at(Math.floor(c.width / 2), c.height - Math.round(c.height * 0.15)) };
  });
  expect(colorName(px.film), '필름스트립').toBe('빨강');
  // 파형 색 #5eead4 = (94, 234, 212)
  const [r, g, b] = px.wave;
  expect(Math.abs(r - 94) + Math.abs(g - 234) + Math.abs(b - 212), `파형 픽셀 ${px.wave}`).toBeLessThan(30);

  // 오디오를 영상 트랙에, 이미지를 텍스트 트랙에 → 거부
  await tile(page, 'audio.wav').dragTo(mainLane(page), { targetPosition: { x: 400, y: 30 } });
  await tile(page, 'image.png').dragTo(lanes(page, 'text').first(), { targetPosition: { x: 400, y: 15 } });
  expect(await allClips(page)).toHaveLength(1);

  // 오디오 트랙에는 들어간다 (x=100px → 50프레임)
  await tile(page, 'audio.wav').dragTo(lanes(page, 'audio').first(), { targetPosition: { x: 100, y: 20 } });
  expect((await clipsOf(page, 'audio', 0)).map((c) => [c.type, c.start, c.duration])).toEqual([['audio', 50, 90]]);
  await expect(page.locator('[data-testid=clip][data-type=audio] canvas')).toHaveCount(1); // 파형
  await page.screenshot({ path: test.info().outputPath('timeline.png') });
});

test('이동: 드래그 한 번 = 기록 1개, 다른 영상 트랙으로 이동, Esc로 취소 (R5.1, R9.3)', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  const id = await addViaPlus(page, 'color-steps.mp4');
  const past0 = (await state(page)).history.past;

  await drag(page, clipEl(page, id), 100); // 100px = 50프레임
  expect((await clipsOf(page, 'video')).map((c) => c.start)).toEqual([50]);
  expect((await state(page)).history.past).toBe(past0 + 1);

  // 위 트랙(영상 2)으로: 영상 트랙 높이 64px
  await drag(page, clipEl(page, id), 0, -64);
  expect((await clipsOf(page, 'video', 0)).map((c) => [c.id, c.start])).toEqual([[id, 50]]);
  expect(await clipsOf(page, 'video', 1)).toHaveLength(0);

  // Esc: 끄는 도중 취소 → 제자리, 기록 없음
  const past1 = (await state(page)).history.past;
  await drag(page, clipEl(page, id), 200, 0, () => page.keyboard.press('Escape'));
  expect((await clipsOf(page, 'video', 0)).map((c) => c.start)).toEqual([50]);
  expect((await state(page)).history.past).toBe(past1);

  await page.keyboard.press('Control+z');
  expect((await clipsOf(page, 'video', 1)).map((c) => c.start)).toEqual([50]);
  await page.keyboard.press('Control+z');
  expect((await clipsOf(page, 'video', 1)).map((c) => c.start)).toEqual([0]);
});

test('스냅(자석): 가까운 클립 가장자리에 붙고, 끄면 붙지 않는다. 겹치면 빈 곳으로 (R5.5, R5.6)', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'image.png']);
  const v = await addViaPlus(page, 'color-steps.mp4'); // 메인 0~120
  await drag(page, clipEl(page, v), 0, -64); // 영상 2로
  await drag(page, clipEl(page, v), 100); // 영상 2: 50~170
  const img = await addViaPlus(page, 'image.png'); // 메인: 0~150
  expect((await clipsOf(page, 'video')).map((c) => [c.start, c.duration])).toEqual([[0, 150]]);

  // 96px = 48프레임 → 영상 2 클립 시작(50)과 2프레임 차이 → 50에 붙는다. 끄는 중에는 스냅선이 보인다
  await drag(page, clipEl(page, img), 96, 0, () => expect(page.getByTestId('snap-line')).toBeVisible());
  expect((await clipsOf(page, 'video')).map((c) => c.start)).toEqual([50]);
  await expect(page.getByTestId('snap-line')).toHaveCount(0);

  // 자석을 끄면 4px(2프레임)만큼 그대로 움직인다
  await page.getByTestId('snap').click();
  await expect(page.getByTestId('snap')).toHaveAttribute('aria-pressed', 'false');
  await drag(page, clipEl(page, img), 4);
  expect((await clipsOf(page, 'video')).map((c) => c.start)).toEqual([52]);

  // 겹침: 영상 클립을 메인 트랙의 이미지(52~202) 위로 → 가장 가까운 빈 구간(이미지 앞 0~52는 좁음 → 202)
  await drag(page, clipEl(page, v), 20, 64);
  const main = await clipsOf(page, 'video');
  expect(main.map((c) => [c.id, c.start])).toEqual([
    [img, 52],
    [v, 202],
  ]);
});

test('트림: 원본 길이와 이웃 클립을 넘지 않고, 이미지는 제한 없이 늘어난다 (R5.2)', async ({ page }) => {
  await setup(page, ['color-steps.mp4', 'image.png']);
  const v = await addViaPlus(page, 'color-steps.mp4'); // 0~120 (원본 120프레임)
  const c = clipEl(page, v);

  await drag(page, c.getByTestId('trim-end'), -40); // 끝 -20프레임
  expect((await clipsOf(page, 'video'))[0]).toMatchObject({ start: 0, duration: 100, inPoint: 0 });
  await drag(page, c.getByTestId('trim-end'), 200); // 원본 끝(120)까지만
  expect((await clipsOf(page, 'video'))[0]).toMatchObject({ start: 0, duration: 120 });
  await drag(page, c.getByTestId('trim-start'), 20); // 시작 +10 → inPoint 10
  expect((await clipsOf(page, 'video'))[0]).toMatchObject({ start: 10, duration: 110, inPoint: 10 });
  await drag(page, c.getByTestId('trim-start'), -100); // 원본 시작(inPoint 0)보다 앞으로는 안 됨
  expect((await clipsOf(page, 'video'))[0]).toMatchObject({ start: 0, duration: 120, inPoint: 0 });

  // 이미지(120~270): 끝을 +300px(150프레임) → 300프레임, 제한 없음
  const img = await addViaPlus(page, 'image.png');
  expect((await clipsOf(page, 'video'))[1]).toMatchObject({ id: img, start: 120, duration: 150 });
  await drag(page, clipEl(page, img).getByTestId('trim-end'), 300);
  expect((await clipsOf(page, 'video'))[1]).toMatchObject({ start: 120, duration: 300 });
  // 이미지 시작을 왼쪽으로 → 영상 끝(120)에서 멈춘다 (겹치지 않음)
  await drag(page, clipEl(page, img).getByTestId('trim-start'), -100);
  expect((await clipsOf(page, 'video'))[1]).toMatchObject({ start: 120 });
});

test('분할(S) → 삭제(Delete) → 실행 취소/다시 실행 (R5.3, R5.4, R9.1)', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  await addViaPlus(page, 'color-steps.mp4');
  await page.getByTestId('ruler').click({ position: { x: 120, y: 10 } }); // 120px = 60프레임
  await expect(page.getByTestId('time-current')).toHaveText('00:02.00');

  await page.keyboard.press('KeyS');
  let main = await clipsOf(page, 'video');
  expect(main.map((c) => [c.start, c.duration, c.inPoint])).toEqual([
    [0, 60, 0],
    [60, 60, 60],
  ]);
  await expect(page.locator('[data-testid=clip]')).toHaveCount(2);

  await clipEl(page, main[1].id).click();
  await page.keyboard.press('Delete');
  expect((await clipsOf(page, 'video')).map((c) => c.id)).toEqual([main[0].id]);

  await page.keyboard.press('Control+z'); // 삭제 취소
  expect(await clipsOf(page, 'video')).toHaveLength(2);
  await page.keyboard.press('Control+y'); // 다시 삭제
  expect(await clipsOf(page, 'video')).toHaveLength(1);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z'); // 분할 취소
  main = await clipsOf(page, 'video');
  expect(main.map((c) => [c.start, c.duration])).toEqual([[0, 120]]);

  // 툴바 버튼도 같은 동작
  await page.getByTestId('split').click();
  expect(await clipsOf(page, 'video')).toHaveLength(2);
  await page.getByTestId('delete').click(); // 분할 후 선택은 왼쪽 조각
  expect((await clipsOf(page, 'video')).map((c) => [c.start, c.inPoint])).toEqual([[60, 60]]);
});

test('줌: 버튼, Ctrl+휠(커서 위치 기준), 브라우저 확대는 일어나지 않음 (R5.7)', async ({ page }) => {
  await setup(page, ['color-steps.mp4']);
  const v = await addViaPlus(page, 'color-steps.mp4');
  const width = async () => (await clipEl(page, v).boundingBox())!.width;
  expect(await width()).toBeCloseTo(240, 0); // 120프레임 × 2px

  await page.getByTestId('zoom-in').click();
  expect(await width()).toBeCloseTo(360, 0);
  await page.getByTestId('zoom-out').click();
  expect(await width()).toBeCloseTo(240, 0);

  // 조금 스크롤한 뒤 커서 아래 프레임이 줌 전후로 같은지 본다
  const scroller = page.getByTestId('timeline-scroller');
  await scroller.evaluate((el) => (el.scrollLeft = 300));
  const sb = (await scroller.boundingBox())!;
  const cx = sb.x + 132 + 400; // 이름 칸 뒤 400px
  const frameAtCursor = () =>
    page.evaluate(
      ([sx]) => {
        const el = document.querySelector('[data-testid=timeline-scroller]')!;
        return (el.scrollLeft + sx) / window.__editor.state().ui.pxPerFrame;
      },
      [400],
    );
  const before = await frameAtCursor();
  await page.mouse.move(cx, sb.y + 80);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await state(page)).ui.pxPerFrame).toBeGreaterThan(2.5);
  expect(Math.abs((await frameAtCursor()) - before)).toBeLessThan(1.5);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
});

test('트랙 추가', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('add-video-track').click();
  await page.getByTestId('add-audio-track').click();
  const kinds = await page.getByTestId('track-lane').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kind));
  expect(kinds).toEqual(['text', 'video', 'video', 'video', 'audio', 'audio']);
  const names = (await state(page)).edit.tracks.map((t) => t.name);
  expect(names).toEqual(['텍스트', '영상 3', '영상 2', '영상 1', '오디오 1', '오디오 2']);
});
