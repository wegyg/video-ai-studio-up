/**
 * 확인 2 체크리스트 3·5·6번을 브라우저 밖의 도구로 확인한다.
 *
 * 6) "내보낸 MP4를 휴대폰에서 재생하면 미리보기와 똑같은가? (텍스트 위치, 애니메이션, 소리)"
 *    → 휴대폰처럼 **Chrome이 아닌 디코더(ffmpeg)**로 내보낸 파일을 풀어, 미리보기 화면과 픽셀을 비교한다.
 *      (Chrome끼리 비교하면 같은 버그를 서로 가려 줄 수 있어서, 독립된 디코더로 한 번 더 본다)
 * 3) "BGM 볼륨과 페이드가 귀로 들리게 적용되는가?" (내보낸 파일 쪽)
 *    → 내보낸 소리를 ffmpeg로 풀어, 원본 대비 소리 크기가 볼륨·페이드 곡선대로인지 잰다.
 * 5) 파일에 바로 쓰는 저장 경로(Windows Chrome이 실제로 쓰는 길)도 올바른 MP4를 만드는지 본다.
 *
 * ffmpeg/ffprobe가 필요하다: 로컬은 FFMPEG_PATH·FFPROBE_PATH, CI는 apt로 설치한 것.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { addViaPlus, lanes, seekRuler, setup, state, tile, waitRendered } from './helpers';
import { fixture } from './fixtures';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const runnable = (bin: string) => {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const HAS_FF = runnable(FFMPEG) && runnable(FFPROBE);

const W = 1080;
const H = 1920;
/** 비교용 격자 (10픽셀 × 10픽셀 칸의 평균). 압축 잡음과 확대 방식 차이를 걸러 준다 */
const BW = 108;
const BH = 192;

/** 격자 평균 (Node와 페이지 양쪽에서 같은 코드를 쓴다) */
function boxDown(data: ArrayLike<number>, w: number, h: number, ch: number, bw: number, bh: number): number[] {
  const sum = new Float64Array(bw * bh * 3);
  const cnt = new Float64Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const by = Math.min(bh - 1, Math.floor((y * bh) / h));
    for (let x = 0; x < w; x++) {
      const bx = Math.min(bw - 1, Math.floor((x * bw) / w));
      const i = (y * w + x) * ch;
      const o = by * bw + bx;
      sum[o * 3] += data[i];
      sum[o * 3 + 1] += data[i + 1];
      sum[o * 3 + 2] += data[i + 2];
      cnt[o]++;
    }
  }
  const out = new Array<number>(bw * bh * 3);
  for (let o = 0; o < bw * bh; o++) for (let c = 0; c < 3; c++) out[o * 3 + c] = sum[o * 3 + c] / Math.max(1, cnt[o]);
  return out;
}

/** 미리보기 캔버스를 격자 평균으로 */
async function previewGrid(page: Page): Promise<number[]> {
  return page.evaluate(
    ([src, bw, bh]) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const fn = new Function(`return ${src}`)() as (...a: unknown[]) => number[];
      return fn(d, c.width, c.height, 4, bw, bh);
    },
    [boxDown.toString(), BW, BH] as const,
  );
}

/** ffmpeg로 n번째 프레임을 풀어 격자 평균으로 (휴대폰처럼 파일의 색 정보를 읽어 RGB로 바꾼다) */
function ffmpegGrid(file: string, n: number): number[] {
  const raw = execFileSync(
    FFMPEG,
    ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n})`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  expect(raw.length, `프레임 ${n} 디코딩`).toBe(W * H * 3);
  return boxDown(raw, W, H, 3, BW, BH);
}

/** 두 격자의 채널당 평균 차이. rows를 주면 그 줄 범위만 */
function meanDiff(a: number[], b: number[], rows?: [number, number]): number {
  const [r0, r1] = rows ?? [0, BH];
  let s = 0;
  let n = 0;
  for (let y = r0; y < r1; y++) {
    for (let x = 0; x < BW; x++) {
      for (let c = 0; c < 3; c++) {
        const i = (y * BW + x) * 3 + c;
        s += Math.abs(a[i] - b[i]);
        n++;
      }
    }
  }
  return s / n;
}

/** 소리를 48kHz 모노 f32로 풀기 */
function pcm(file: string, stream = '0:a:0'): Float32Array {
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-map', stream, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

function rms(x: Float32Array, fromSec: number, toSec: number): number {
  const a = Math.max(0, Math.floor(fromSec * 48000));
  const b = Math.min(x.length, Math.floor(toSec * 48000));
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

/**
 * 내보낸 소리가 원본보다 얼마나 늦게 시작하는지(샘플) — AAC 인코더 앞부분 지연.
 * 5ms 단위 소리 크기 곡선끼리 맞춰 본다 (파형 자체는 주기가 짧아 여러 곳에서 맞아 버린다).
 */
function audioLag(out: Float32Array, src: Float32Array, fromSec: number, toSec: number, maxMs = 120): number {
  const hop = 48; // 1ms
  const win = 240; // 5ms
  const env = (x: Float32Array, i: number) => {
    let s = 0;
    for (let k = 0; k < win; k++) s += (x[i + k] ?? 0) ** 2;
    return Math.sqrt(s / win);
  };
  const a = Math.floor(fromSec * 48000);
  const b = Math.floor(toSec * 48000);
  const srcEnv: number[] = [];
  for (let i = a; i < b; i += hop) srcEnv.push(env(src, i));
  let best = 0;
  let bestErr = Infinity;
  for (let lagMs = 0; lagMs <= maxMs; lagMs++) {
    let err = 0;
    let n = 0;
    for (let j = 0; j < srcEnv.length; j++) {
      const o = env(out, a + j * hop + lagMs * hop);
      err += (o - srcEnv[j] * 0.5) ** 2; // 이 구간 BGM 볼륨은 50%
      n++;
    }
    if (err / n < bestErr) {
      bestErr = err / n;
      best = lagMs;
    }
  }
  return best * hop;
}

/** 휴대폰 재생 확인용 프로젝트: 영상(소리 끔) + 한글 자막(위치 이동·팝 등장·페이드 퇴장) + BGM(50%, 1초 페이드 인) */
async function buildPhoneProject(page: Page) {
  await setup(page, ['color-steps.mp4', 'audio.wav']);
  await addViaPlus(page, 'color-steps.mp4'); // 0~120, 빨강→초록→파랑→노랑
  await page.getByTestId('prop-volume').fill('0'); // 영상 소리는 끄고 BGM만 남긴다 (소리 비교를 깔끔하게)

  await tile(page, 'audio.wav').dragTo(lanes(page, 'audio').first(), { targetPosition: { x: 4, y: 20 } }); // 0~90
  await page.getByTestId('prop-volume').fill('50');
  await page.getByTestId('prop-fade-in').fill('1');
  await page.getByTestId('prop-fade-in').press('Enter');

  await seekRuler(page, 0);
  await page.getByRole('tab', { name: '텍스트' }).click();
  await page.getByTestId('add-text').click();
  await page.getByTestId('text-content').fill('휴대폰 확인 자막');
  await page.getByTestId('text-content').blur();
  await page.locator('[data-testid=text-preset][data-preset-id="shorts-highlight"]').click();
  await page.getByTestId('prop-y').fill('550');
  await page.getByTestId('prop-y').press('Enter');
  await page.getByTestId('text-end').fill('4');
  await page.getByTestId('text-end').press('Enter');
  await page.getByTestId('anim-in').selectOption('pop');
  await page.getByTestId('anim-in-duration').fill('1');
  await page.getByTestId('anim-in-duration').press('Enter');
  await page.getByTestId('anim-out').selectOption('fade');
  await page.getByTestId('anim-out-duration').fill('0.5');
  await page.getByTestId('anim-out-duration').press('Enter');
  // 애니메이션을 고르면 미리 재생이 돌아가므로 끝날 때까지 기다린다
  await expect.poll(async () => (await state(page)).ui.playing, { timeout: 5000 }).toBe(false);

  const s = await state(page);
  const text = s.edit.tracks[0].clips[0];
  expect([text.start, text.duration, text.animIn?.type, text.animIn?.duration, text.animOut?.type, text.animOut?.duration]).toEqual([
    0, 120, 'pop', 30, 'fade', 15,
  ]);
  expect(text.transform?.y).toBe(550);
  const bgm = s.edit.tracks[3].clips[0];
  expect([bgm.start, bgm.duration, bgm.volume, bgm.fadeIn]).toEqual([0, 90, 0.5, 30]);
}

test.describe('휴대폰 재생 = 미리보기 (독립 디코더 ffmpeg로 확인)', () => {
  test.skip(!HAS_FF, 'ffmpeg/ffprobe가 없으면 건너뜀');

  test('6) 텍스트 위치·애니메이션·소리가 미리보기와 같고, 휴대폰이 읽을 수 있는 형식이다', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    });
    await buildPhoneProject(page);

    // 미리보기 화면 기록: 팝 등장 중(8), 정지 상태(45), 페이드 퇴장 중(112)
    // ① 사용자가 보는 크기 그대로 ② 같은 엔진으로 1080×1920에 그린 것
    //    (①은 화면이 작아 글자 테두리가 뭉개져 보이므로, 내용 비교는 ②로 한다)
    const frames = [8, 45, 112];
    const shown: number[][] = [];
    for (const f of frames) {
      await seekRuler(page, f);
      await waitRendered(page, f);
      shown.push(await previewGrid(page));
    }
    await page.evaluate(() => window.__editor.setPreviewResolution(1080, 1920));
    const preview: number[][] = [];
    for (const f of frames) {
      await seekRuler(page, f);
      await waitRendered(page, f);
      preview.push(await previewGrid(page));
    }

    // 내보내기
    await page.getByTestId('open-export').click();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.getByTestId('export-start').click()]);
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 180_000 });
    const file = test.info().outputPath('phone.mp4');
    await download.saveAs(file);

    // --- 휴대폰이 읽을 수 있는 형식인가 (ffprobe) ---
    const probe = JSON.parse(
      execFileSync(FFPROBE, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]).toString(),
    ) as { streams: Record<string, string | number>[]; format: Record<string, string> };
    const v = probe.streams.find((s) => s.codec_type === 'video')!;
    const a = probe.streams.find((s) => s.codec_type === 'audio')!;
    const report = {
      video: `${v.codec_name} ${v.profile} L${v.level} ${v.pix_fmt} ${v.width}x${v.height} ${v.r_frame_rate} frames=${v.nb_read_frames}`,
      color: `range=${v.color_range} matrix=${v.color_space} transfer=${v.color_transfer} primaries=${v.color_primaries}`,
      audio: `${a.codec_name} ${a.profile} ${a.sample_rate}Hz ${a.channels}ch`,
    };
    expect(v.codec_name).toBe('h264');
    expect(['High', 'Main', 'Constrained Baseline', 'Baseline']).toContain(v.profile);
    expect(Number(v.level)).toBeLessThanOrEqual(42); // 휴대폰 하드웨어 디코더가 모두 지원하는 범위
    expect(['yuv420p', 'yuvj420p']).toContain(v.pix_fmt);
    expect([v.width, v.height]).toEqual([W, H]);
    expect(v.r_frame_rate).toBe('30/1');
    expect(Number(v.nb_read_frames)).toBe(120);
    expect(a.codec_name).toBe('aac');
    expect(a.profile).toBe('LC');
    expect(Number(a.sample_rate)).toBe(48000);
    expect(Number(a.channels)).toBe(2);

    // --- 화면이 같은가 (텍스트 위치, 애니메이션) ---
    const exported = frames.map((f) => ffmpegGrid(file, f));
    const TEXT_ROWS: [number, number] = [140, 175]; // 자막이 있는 줄 (y ≈ 960 + 550 = 1510 근처)
    const whole = frames.map((_, i) => meanDiff(preview[i], exported[i]));
    const wholeShown = frames.map((_, i) => meanDiff(shown[i], exported[i]));
    const textBand = frames.map((_, i) => meanDiff(preview[i], exported[i], TEXT_ROWS));
    // 파일 안에서 애니메이션이 실제로 움직이는가: 팝 중(8)과 정지(45)의 자막 줄이 달라야 한다
    const animMoves = meanDiff(exported[0], exported[1], TEXT_ROWS);
    // 미리보기 쪽에서도 같은 차이가 나야 한다 (둘 다 같은 애니메이션)
    const animMovesPreview = meanDiff(preview[0], preview[1], TEXT_ROWS);

    // --- 소리가 같은가 (볼륨 50%, 1초 페이드 인) ---
    const out = pcm(file);
    const src = pcm(fixture('audio.wav'));
    const lag = audioLag(out, src, 1.2, 2.8); // 볼륨이 일정한 구간에서 잰다
    const lagSec = lag / 48000;
    const ratioAt = (t: number) => rms(out, t - 0.05 + lagSec, t + 0.05 + lagSec) / Math.max(1e-6, rms(src, t - 0.05, t + 0.05));
    const expected = (t: number) => 0.5 * Math.min(1, t / 1);
    const checkpoints = [0.25, 0.55, 0.85, 1.5, 2.5];
    const audio = checkpoints.map((t) => ({ t, 측정: Number(ratioAt(t).toFixed(3)), 이론: expected(t) }));
    const silenceAfter = rms(out, 3.2, 3.9); // BGM이 끝난 뒤(3초~)는 조용해야 한다 (영상 소리는 0%)

    const all = {
      ...report,
      화면차이_보이는크기: wholeShown.map((d) => Number(d.toFixed(2))),
      화면차이_전체: whole.map((d) => Number(d.toFixed(2))),
      화면차이_자막줄: textBand.map((d) => Number(d.toFixed(2))),
      애니메이션_움직임_파일: Number(animMoves.toFixed(2)),
      애니메이션_움직임_미리보기: Number(animMovesPreview.toFixed(2)),
      소리지연_ms: Number(((lag / 48000) * 1000).toFixed(1)),
      소리비율: audio,
      BGM끝난뒤_소리: Number(silenceAfter.toFixed(4)),
    };
    test.info().annotations.push({ type: 'phone', description: JSON.stringify(all) });
    console.log('PHONE ' + JSON.stringify(all));

    for (let i = 0; i < frames.length; i++) {
      expect(wholeShown[i], `프레임 ${frames[i]} 보이는 크기 전체 평균 차이`).toBeLessThanOrEqual(3);
      expect(whole[i], `프레임 ${frames[i]} 전체 평균 차이`).toBeLessThanOrEqual(3);
      expect(textBand[i], `프레임 ${frames[i]} 자막 줄 평균 차이`).toBeLessThanOrEqual(3);
    }
    expect(animMoves, '내보낸 파일에서 팝 애니메이션이 보여야 함').toBeGreaterThan(3);
    expect(Math.abs(animMoves - animMovesPreview), '애니메이션 모양이 미리보기와 같아야 함').toBeLessThan(2);
    // 소리가 화면보다 늦게 나오는 정도: 사람이 알아채는 한계(약 125ms 늦음)보다 훨씬 작아야 한다
    expect(lag / 48000, '소리 지연(초)').toBeLessThan(0.06);
    for (const p of audio) expect(Math.abs(p.측정 - p.이론), `${p.t}초 소리 크기`).toBeLessThan(0.03);
    expect(silenceAfter).toBeLessThan(0.003);
  });
});

test('5) 파일에 바로 쓰는 저장(Windows Chrome의 "저장 위치 고르기")도 올바른 Fast Start MP4를 만든다', async ({ page }) => {
  test.setTimeout(180_000);
  // 저장 위치 창 대신 브라우저 전용 저장소(OPFS)의 진짜 파일 핸들을 돌려준다 → 실제 FileSystemWritableFileStream으로 쓴다
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = async () =>
      (await navigator.storage.getDirectory()).getFileHandle('picked.mp4', { create: true });
  });
  await setup(page, ['color-steps.mp4', 'audio.mp3']);
  await addViaPlus(page, 'color-steps.mp4');
  await tile(page, 'audio.mp3').dragTo(lanes(page, 'audio').first(), { targetPosition: { x: 4, y: 20 } });

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId('toast').last()).toContainText('파일로 저장했습니다');

  const r = await page.evaluate(() => window.__editor.inspectOpfsFile('picked.mp4'));
  test.info().annotations.push({ type: 'fs-path', description: JSON.stringify(r) });
  expect(r.info.videoCodec).toBe('avc');
  expect(r.info.audioCodec).toBe('aac');
  // 영상 4초, BGM 약 5초 → 더 긴 쪽까지 나온다
  const total = Math.max(...(await state(page)).edit.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)));
  expect(r.info.frameCount).toBe(total);
  // Fast Start: 목차(moov)가 영상 데이터(mdat)보다 앞 → 휴대폰·SNS에서 앞부분만 받아도 바로 재생
  expect(r.boxes.indexOf('moov')).toBeGreaterThanOrEqual(0);
  expect(r.boxes.indexOf('moov')).toBeLessThan(r.boxes.indexOf('mdat'));
});
