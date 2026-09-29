/** 파형 그리기 (미디어 타일, 타임라인 클립 공용). peaks = 초당 100개 최대 진폭. */
import { useLayoutEffect, useRef } from 'react';
import { PEAKS_PER_SEC } from '../media/derive-protocol';

/** (x, y, w, h) 영역에 [startSec, endSec] 구간의 파형을 가운데 기준 막대로 그린다 */
export function drawPeaks(
  ctx: CanvasRenderingContext2D,
  peaks: Float32Array,
  startSec: number,
  endSec: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  const span = Math.max(1e-6, endSec - startSec);
  const mid = y + h / 2;
  ctx.fillStyle = color;
  for (let px = 0; px < w; px++) {
    const a = Math.floor((startSec + (px / w) * span) * PEAKS_PER_SEC);
    const b = Math.max(a + 1, Math.floor((startSec + ((px + 1) / w) * span) * PEAKS_PER_SEC));
    let m = 0;
    for (let i = Math.max(0, a); i < Math.min(peaks.length, b); i++) if (peaks[i] > m) m = peaks[i];
    const bar = Math.max(1, m * h * 0.95);
    ctx.fillRect(x + px, mid - bar / 2, 1, bar);
  }
}

/** 요소 크기에 맞춰 파일 전체 파형을 그리는 캔버스 */
export function Waveform({ peaks, color = '#67e8f9', className }: { peaks: Float32Array; color?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawPeaks(ctx, peaks, 0, peaks.length / PEAKS_PER_SEC, 0, 0, w, h, color);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [peaks, color]);
  return <canvas ref={ref} className={className} />;
}
