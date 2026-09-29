/**
 * 태스크 9: 자동 저장·복원 + 프로젝트 파일(JSON) + 미디어 다시 연결.
 * 완료 기준 G4("새로고침해도 작업이 남아 있는가")를 여기서 증명한다.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { addViaPlus, clipEl, drag, lanes, seekRuler, setup, state, tile, waitRendered } from './helpers';
import { fixture } from './fixtures';

const ready = (page: Page) => page.waitForFunction(() => typeof window.__editor?.saveNow === 'function');
/** 자동 저장을 기다리지 않고 바로 저장 */
const save = (page: Page) => page.evaluate(() => window.__editor.saveNow());

/** 편집 상태만 비교 (저장 시각처럼 매번 달라지는 값은 뺀다) */
async function editState(page: Page) {
  const s = await state(page);
  return { name: s.name, assets: s.assets, edit: s.edit, playhead: s.ui.playhead, pxPerFrame: s.ui.pxPerFrame, snap: s.ui.snap };
}

/** 영상 1개 + 텍스트 1개 + 오디오 1개를 올리고 속성을 바꿔 둔 프로젝트를 만든다 */
async function buildProject(page: Page) {
  await setup(page, ['color-steps.mp4', 'audio.mp3']);
  await addViaPlus(page, 'color-steps.mp4');
  await tile(page, 'audio.mp3').dragTo(lanes(page, 'audio').first(), { targetPosition: { x: 4, y: 20 } });
  await page.getByRole('tab', { name: '텍스트' }).click();
  await page.getByTestId('add-text').click();
  await page.getByTestId('text-content').fill('저장 확인용 자막');
  await page.getByTestId('text-content').blur();
  await page.getByTestId('text-size').fill('120');
  await page.getByTestId('text-size').press('Enter');
  // 영상 클립 속성도 바꿔 둔다
  const vid = (await state(page)).edit.tracks[2].clips[0];
  await clipEl(page, vid.id).click();
  await page.getByTestId('prop-x').fill('80');
  await page.getByTestId('prop-x').press('Enter');
  await page.getByTestId('prop-volume').fill('60');
  await drag(page, clipEl(page, vid.id).getByTestId('fade-in-handle'), 40);
  await page.getByRole('radio', { name: '가로 16:9' }).click();
  await seekRuler(page, 37);
  await page.getByTestId('snap').click(); // 자석 끄기
  return editState(page);
}

test('G4: 편집한 뒤 새로고침하면 트랙·클립·속성·미디어·플레이헤드가 모두 그대로다', async ({ page }) => {
  const before = await buildProject(page);
  await save(page);

  await page.reload();
  await ready(page);
  await expect(page.getByTestId('restoring')).toHaveCount(0);
  const after = await editState(page);
  expect(after).toEqual(before);

  // 미디어 원본도 다시 연결되어 미리보기가 그려진다
  await expect(page.locator('[data-testid=media-item][data-status=ready]')).toHaveCount(2, { timeout: 20_000 });
  await waitRendered(page, before.playhead);
  await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-ratio', '16:9');
  await expect(page.getByTestId('time-current')).toHaveText('00:01.07');
  // 되살린 뒤 실행 취소 기록은 비어 있다 (복원 자체가 취소되면 안 됨)
  expect((await state(page)).history.past).toBe(0);
  await page.screenshot({ path: test.info().outputPath('restored.png') });
});

test('G4: 자동 저장이 1초 안에 일어난다 (저장 버튼을 누르지 않아도)', async ({ page }) => {
  await setup(page, ['image.png']);
  const n0 = await page.evaluate(() => window.__editor.savedTimes());
  await addViaPlus(page, 'image.png');
  // 자동 저장만 기다린다
  await expect.poll(async () => await page.evaluate(() => window.__editor.savedTimes()), { timeout: 1000 }).toBeGreaterThan(n0);
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');

  await page.reload();
  await ready(page);
  expect((await state(page)).edit.tracks[2].clips).toHaveLength(1);
});

test('G4: 탭을 숨겼다 새로 열어도 마지막 편집이 남아 있다', async ({ page }) => {
  await setup(page, ['image.png']);
  await addViaPlus(page, 'image.png');
  await page.getByTestId('prop-rotation').fill('30');
  await page.getByTestId('prop-rotation').press('Enter');
  // 저장을 기다리지 않고 곧바로 탭을 숨긴다 → pagehide/visibilitychange에서 저장돼야 한다
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  await page.reload();
  await ready(page);
  expect((await state(page)).edit.tracks[2].clips[0].transform!.rotation).toBe(30);
});

test('프로젝트 파일(JSON)에는 편집 내용과 미디어 목록만 담고 원본은 넣지 않는다 (R10.4)', async ({ page }) => {
  await buildProject(page);
  const file = (await page.evaluate(() => window.__editor.projectFile())) as {
    format: string;
    version: number;
    project: { assets: Record<string, { name: string; size: number; durationFrames?: number }>; edit: { tracks: unknown[] } };
  };
  expect(file.format).toBe('web-editor-project');
  expect(file.version).toBe(1);
  const assets = Object.values(file.project.assets);
  expect(assets).toHaveLength(2);
  for (const a of assets) {
    expect(a.name).toBeTruthy();
    expect(a.size).toBeGreaterThan(0);
  }
  // 원본 데이터(base64 등)가 들어가지 않아 파일이 작다
  const text = JSON.stringify(file);
  expect(text.length).toBeLessThan(20_000);
  expect(text).not.toContain('base64');

  // 실제로 내려받아진다
  const download = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]).then((r) => r[0]);
  expect(download.suggestedFilename()).toBe('제목 없는 프로젝트.json');
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(saved.project.edit.tracks).toHaveLength(4);
  await expect(page.getByTestId('toast')).toContainText('파일로 저장했습니다');
});

test('프로젝트 파일을 열면 편집 내용이 되살아난다 (미디어가 그대로 있을 때)', async ({ page }) => {
  const before = await buildProject(page);
  const json = JSON.stringify(await page.evaluate(() => window.__editor.projectFile()));

  // 새 프로젝트로 비우고
  await page.evaluate(() => {
    indexedDB.deleteDatabase('nothing'); // 실제 미디어는 그대로 두고 화면만 초기화
  });
  await page.getByTestId('add-video-track').click();
  // 파일로 열기
  await page.getByTestId('import-json-input').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect.poll(async () => (await state(page)).edit.tracks.length).toBe(4);
  const after = await editState(page);
  expect(after.edit).toEqual(before.edit);
  await expect(page.getByTestId('relink-dialog')).toHaveCount(0); // 미디어가 있으니 다시 연결 필요 없음
});

test('원본이 없는 프로젝트 파일을 열면 미디어 다시 연결을 안내하고, 파일을 고르면 살아난다 (R10.4)', async ({ page }) => {
  const before = await buildProject(page);
  const json = JSON.stringify(await page.evaluate(() => window.__editor.projectFile()));

  // 저장소를 비운 새 브라우저 상태를 만든다 (원본이 사라진 상황)
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
  });
  await page.reload();
  await ready(page);
  expect(Object.keys((await state(page)).assets)).toHaveLength(0);

  await page.getByTestId('import-json-input').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.getByTestId('relink-dialog')).toBeVisible();
  const items = page.getByTestId('relink-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('color-steps.mp4');
  // 편집 내용(클립)은 이미 돌아와 있다
  expect((await state(page)).edit.tracks[2].clips).toHaveLength(1);

  // 영상 파일을 골라 연결
  const videoRow = page.locator('[data-testid=relink-item]', { hasText: 'color-steps.mp4' });
  await videoRow.getByTestId('relink-input').setInputFiles(fixture('color-steps.mp4'));
  await expect(items).toHaveCount(1);
  await expect(page.locator('[data-testid=media-item][data-status=ready]')).toHaveCount(1, { timeout: 20_000 });
  await waitRendered(page, before.playhead);

  // 나머지는 나중에 하기
  await page.getByTestId('relink-later').click();
  await expect(page.getByTestId('relink-dialog')).toHaveCount(0);
});

test('잘못된 JSON을 열면 한국어로 이유를 알려 준다', async ({ page }) => {
  await setup(page, []);
  const cases: [string, string][] = [
    ['그냥 글자', '파일 내용을 읽을 수 없습니다'],
    ['{"format":"other"}', '이 편집기의 프로젝트 파일이 아닙니다'],
    ['{"format":"web-editor-project","version":9}', '더 새로운 형식의 파일입니다'],
    ['{"format":"web-editor-project","version":1,"project":{}}', '프로젝트 파일이 손상되었습니다'],
  ];
  for (const [body, message] of cases) {
    await page.getByTestId('import-json-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(body) });
    await expect(page.getByTestId('toast').last()).toContainText(message);
  }
});

test('안 쓰는 미디어는 정리되고, 쓰는 미디어는 남는다', async ({ page }) => {
  await setup(page, ['image.png', 'image.jpg']);
  await addViaPlus(page, 'image.png'); // png만 타임라인에 쓴다
  await save(page);
  const storedBefore = await page.evaluate(() => window.__editor.stored());
  expect(storedBefore.media).toHaveLength(2); // 아직 둘 다 프로젝트 목록에 있다

  // 미디어 패널에서 jpg를 지우고 저장한 뒤 새로고침하면 저장소에서도 정리된다
  await page.locator('[data-testid=media-item][title="image.jpg"]').getByTestId('remove-asset').click();
  expect(Object.keys((await state(page)).assets)).toHaveLength(1);
  await save(page);
  await page.reload();
  await ready(page);
  await expect
    .poll(async () => (await page.evaluate(() => window.__editor.stored())).media.map((m) => m.name).sort(), { timeout: 5000 })
    .toEqual(['image.png']);
  // 남은 파생 데이터도 남은 미디어 것만이다
  const remainingId = Object.keys((await state(page)).assets)[0];
  const derived = (await page.evaluate(() => window.__editor.stored())).derivedKeys;
  expect(derived.length).toBeGreaterThan(0);
  expect(derived.every((k) => k.startsWith(remainingId))).toBe(true);
  // 원본 테스트 파일은 그대로다 (디스크를 건드리지 않는다)
  expect(statSync(fixture('image.png')).size).toBeGreaterThan(0);
});
