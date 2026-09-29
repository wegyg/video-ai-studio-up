/**
 * E2E 공용: "미리보기 = 내보내기" 픽셀 비교 (2단계 규칙 — 태스크마다 같은 프레임을 두 곳에서 뽑아 비교).
 * 미리보기 캔버스와 내보낸 MP4의 같은 프레임을 같은 격자(기본 27×48칸)로 평균 내어 비교한다.
 */
import { expect, type Page } from '@playwright/test';
import { seekRuler, waitRendered } from './helpers';

/** 미리보기 격자 평균 (0~255, 가로 gx × 세로 gy 칸, 칸마다 RGB 3개) */
export async function previewGrid(page: Page, gx = 27, gy = 48): Promise<number[]> {
  return page.evaluate(
    ([gx, gy]) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const out: number[] = [];
      for (let j = 0; j < gy; j++) {
        for (let i = 0; i < gx; i++) {
          const x0 = Math.floor((i * c.width) / gx);
          const x1 = Math.floor(((i + 1) * c.width) / gx);
          const y0 = Math.floor((j * c.height) / gy);
          const y1 = Math.floor(((j + 1) * c.height) / gy);
          const s = [0, 0, 0];
          let n = 0;
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const k = (y * c.width + x) * 4;
              s[0] += d[k];
              s[1] += d[k + 1];
              s[2] += d[k + 2];
              n++;
            }
          out.push(s[0] / n, s[1] / n, s[2] / n);
        }
      }
      return out;
    },
    [gx, gy],
  );
}

/** 마지막으로 내보낸 MP4의 같은 프레임을 같은 격자로 (칸마다 3×3 점 평균) */
export async function exportGrid(page: Page, frame: number, gx = 27, gy = 48) {
  const pts: [number, number][] = [];
  for (let j = 0; j < gy; j++)
    for (let i = 0; i < gx; i++)
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++) pts.push([(i + (a + 0.5) / 3) / gx, (j + (b + 0.5) / 3) / gy]);
  const r = await page.evaluate(([t, p]) => window.__editor.verifyLastExport([t as number], p as [number, number][]), [frame / 30 + 0.001, pts] as const);
  const px = r.frames[0].pixels;
  const out: number[] = [];
  for (let c = 0; c < gx * gy; c++) {
    const s = [0, 0, 0];
    for (let k = 0; k < 9; k++) for (let ch = 0; ch < 3; ch++) s[ch] += px[c * 9 + k][ch];
    out.push(s[0] / 9, s[1] / 9, s[2] / 9);
  }
  return { grid: out, info: r.info };
}

export const meanDiff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

/** 내보내기 창을 열어 기본 설정으로 내보내고 닫는다 (다운로드 저장 경로) */
export async function runExport(page: Page): Promise<void> {
  await page.getByTestId('open-export').click();
  await Promise.all([page.waitForEvent('download', { timeout: 150_000 }), page.getByTestId('export-start').click()]);
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 150_000 });
  await page.getByTestId('export-close').click();
}

/**
 * 미리보기를 내보내기와 같은 해상도로 그린 뒤 frames의 격자를 모으고, 내보내서 같은 프레임과 비교한다.
 * @returns 프레임별 평균 차이 (0~255)
 */
export async function previewVsExport(page: Page, frames: number[], label: string): Promise<number[]> {
  // 작은 미리보기는 확대 방식 차이만큼 흐릿하므로 내보내기와 같은 1080×1920으로 그린다
  await page.evaluate(() => window.__editor.setPreviewResolution(1080, 1920));
  const preview: number[][] = [];
  for (const f of frames) {
    await seekRuler(page, f);
    await waitRendered(page, f);
    preview.push(await previewGrid(page));
  }
  await runExport(page);
  const diffs: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const { grid, info } = await exportGrid(page, frames[i]);
    expect([info.width, info.height]).toEqual([1080, 1920]);
    diffs.push(Number(meanDiff(preview[i], grid).toFixed(2)));
  }
  console.log(`${label} ${JSON.stringify(diffs)}`);
  return diffs;
}
