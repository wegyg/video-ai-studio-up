/**
 * 2단계 6번: BGM 자동 덕킹 + 영상에서 오디오 분리 (R19). 짧은 클립(3~5초).
 * 소리 작업이라 "미리보기 = 내보내기"는 픽셀 대신 소리 크기로 비교한다: 미리보기 GainNode 값과 내보낸 파일의 소리 크기.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fixture } from './fixtures';
import { addViaPlus, clipEl, lanes, seekRuler, setup, state, tile } from './helpers';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const hasFfmpeg = (() => {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const all = async (page: Page) => (await state(page)).edit.tracks.flatMap((t) => t.clips);
const byId = async (page: Page, id: string) => (await all(page)).find((c) => c.id === id);

function pcm(file: string): Float32Array {
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}
const rms = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  const i0 = Math.round(a * 48000);
  const i1 = Math.round(b * 48000);
  for (let i = i0; i < i1; i++) s += x[i] * x[i];
  return Math.sqrt(s / (i1 - i0));
};
/** t초 둘레 0.1초에서 hz 성분의 크기 (Goertzel) */
function tone(x: Float32Array, t: number, hz: number): number {
  const n = 4800;
  const i0 = Math.round(t * 48000) - n / 2;
  const w = (2 * Math.PI * hz) / 48000;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s = x[i0 + i] + 2 * Math.cos(w) * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (2 * Math.sqrt(s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2)) / n;
}

async function exportFile(page: Page, name: string): Promise<string> {
  await page.getByTestId('open-export').click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByTestId('export-start').click()]);
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('export-close').click();
  const file = test.info().outputPath(name);
  await dl.saveAs(file);
  return file;
}

/** 재생하면서 클립별 GainNode 값을 모은다: [프레임, 값] */
async function sampleGains(page: Page, ids: string[], ms: number): Promise<Record<string, [number, number][]>> {
  await seekRuler(page, 0);
  await page.keyboard.press('Space');
  const out: Record<string, [number, number][]> = Object.fromEntries(ids.map((i) => [i, []]));
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.waitForTimeout(100);
    const r = await page.evaluate((ids) => ({ f: window.__editor.state().ui.playhead, g: ids.map((i) => window.__editor.clipGain(i)) }), ids);
    ids.forEach((id, k) => r.g[k] !== null && out[id].push([r.f, r.g[k]!]));
  }
  await page.keyboard.press('Space');
  return out;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
});

test('오디오 분리: 영상 소리가 같은 구간의 오디오 클립으로 떨어지고, 소리는 한 번만 난다 (실행 취소 1번)', async ({ page }) => {
  await setup(page, ['color-steps.mp4']); // 4초, 440Hz 소리
  const v = await addViaPlus(page, 'color-steps.mp4');
  await clipEl(page, v).click();
  const past = (await state(page)).history.past;
  await page.getByTestId('detach-audio').click();
  const a = (await state(page)).ui.selectedClipId!;
  const clips = await all(page);
  const audio = clips.find((c) => c.id === a)!;
  expect([audio.type, audio.start, audio.duration, audio.assetId]).toEqual(['audio', 0, 120, (await byId(page, v))!.assetId]);
  expect((await state(page)).edit.tracks.findIndex((t) => t.clips.some((c) => c.id === a))).toBe(3); // 오디오 트랙
  expect((await byId(page, v))!.audioDetached).toBe(true);
  expect((await state(page)).history.past).toBe(past + 1);
  await clipEl(page, v).click();
  await expect(page.getByTestId('audio-detached')).toBeVisible();
  await expect(page.getByTestId('detach-audio')).toHaveCount(0);

  // 미리보기: 영상 클립 소리는 0, 떼어 낸 오디오 클립이 소리를 낸다
  const g = await sampleGains(page, [v, a], 1200);
  expect(g[a].filter(([f]) => f > 8).every(([, x]) => x > 0.9)).toBe(true);
  expect(g[v].every(([, x]) => x < 0.01)).toBe(true);

  // 실행 취소 1번이면 둘 다 되돌아간다
  await page.keyboard.press('Control+z');
  expect(await byId(page, a)).toBeUndefined();
  expect((await byId(page, v))!.audioDetached).toBeUndefined();
  await page.keyboard.press('Control+y');
  expect((await byId(page, v))!.audioDetached).toBe(true);

  test.skip(!hasFfmpeg, 'ffmpeg 필요');
  const out = pcm(await exportFile(page, 'detached.mp4'));
  const src = pcm(fixture('color-steps.mp4'));
  const r = rms(out, 1.4, 1.6) / rms(src, 1.4, 1.6);
  console.log('DETACH_AUDIO ' + r.toFixed(3));
  expect(Math.abs(r - 1)).toBeLessThan(0.05); // 두 번 겹쳐 나면 2배
});

test('자동 덕킹: 나레이션이 나오는 동안 BGM이 30%로 줄고 끝나면 돌아온다 — 미리보기 소리 = 내보낸 파일 소리', async ({ page }) => {
  await setup(page, ['audio.mp3', 'audio.wav']); // BGM 440Hz 5초 / 나레이션 660Hz 3초
  await seekRuler(page, 30);
  const voice = await addViaPlus(page, 'audio.wav'); // 오디오 1: 30~120
  expect((await byId(page, voice))!.start).toBe(30);
  await page.getByTestId('add-audio-track').click();
  const lane = lanes(page, 'audio').nth(1);
  await tile(page, 'audio.mp3').dragTo(lane, { targetPosition: { x: 2, y: 20 } });
  const bgm = (await all(page)).find((c) => c.type === 'audio' && c.id !== voice)!;
  expect(bgm.start).toBe(0);
  await clipEl(page, bgm.id).click();
  await page.getByTestId('prop-duck').check();
  expect((await byId(page, bgm.id))!.duck).toBe(0.3);

  // 미리보기: 나레이션 전(0~22) ≈ 1, 나레이션 중(40~110) ≈ 0.3
  const g = (await sampleGains(page, [bgm.id], 4300))[bgm.id];
  const before = g.filter(([f]) => f > 3 && f < 20).map(([, x]) => x);
  const during = g.filter(([f]) => f > 40 && f < 110).map(([, x]) => x);
  console.log('DUCK_PREVIEW ' + JSON.stringify({ before, during }));
  expect(before.length).toBeGreaterThan(0);
  expect(during.length).toBeGreaterThan(3);
  expect(before.every((x) => x > 0.9)).toBe(true);
  expect(during.every((x) => Math.abs(x - 0.3) < 0.05)).toBe(true);

  test.skip(!hasFfmpeg, 'ffmpeg 필요');
  const out = pcm(await exportFile(page, 'ducking.mp4'));
  // BGM(440Hz) 크기: 0.5초(덕킹 전)와 2.5초(나레이션 중) — 원본 BGM은 두 순간 크기가 같다
  const ratio = tone(out, 2.5, 440) / tone(out, 0.5, 440);
  const narration = tone(out, 2.5, 660);
  console.log('DUCK_EXPORT ' + JSON.stringify({ ratio: Number(ratio.toFixed(3)), narration: Number(narration.toFixed(3)) }));
  expect(Math.abs(ratio - 0.3)).toBeLessThan(0.05);
  expect(narration).toBeGreaterThan(0.1);
});
