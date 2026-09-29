import { useEffect, useRef } from 'react';
import { ko } from '../../i18n/ko';
import { formatTimecode } from '../../model/time';
import { FPS } from '../../model/types';
import { useUI } from '../../store/ui';
import { actions } from '../../actions';
import { HEADER_W, RULER_H, rulerSteps } from './layout';

/** 보이는 구간만 그리는 눈금 캔버스. 캔버스는 sticky라 가로 스크롤해도 화면에 붙어 있다. */
function drawRuler(canvas: HTMLCanvasElement, scrollLeft: number, width: number, ppf: number) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(width));
  if (canvas.width !== w * dpr || canvas.height !== RULER_H * dpr) {
    canvas.width = w * dpr;
    canvas.height = RULER_H * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${RULER_H}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, RULER_H);
  const { major, minor } = rulerSteps(ppf);
  const first = Math.floor(scrollLeft / ppf);
  const last = Math.ceil((scrollLeft + w) / ppf);
  ctx.strokeStyle = '#525252';
  ctx.fillStyle = '#a3a3a3';
  ctx.font = '10px Pretendard, sans-serif';
  ctx.textBaseline = 'top';
  ctx.beginPath();
  if (minor) {
    for (let f = Math.floor(first / minor) * minor; f <= last; f += minor) {
      if (f % major === 0) continue;
      const x = Math.round(f * ppf - scrollLeft) + 0.5;
      ctx.moveTo(x, RULER_H - 5);
      ctx.lineTo(x, RULER_H);
    }
  }
  for (let f = Math.floor(first / major) * major; f <= last; f += major) {
    const x = Math.round(f * ppf - scrollLeft) + 0.5;
    ctx.moveTo(x, RULER_H - 12);
    ctx.lineTo(x, RULER_H);
    const label = major < FPS ? formatTimecode(f) : formatTimecode(f).slice(0, 5);
    ctx.fillText(label, x + 3, 3);
  }
  ctx.stroke();
}

export function Ruler({ scroller, laneWidth }: { scroller: HTMLDivElement | null; laneWidth: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const ppf = useUI((s) => s.pxPerFrame);

  useEffect(() => {
    const el = scroller;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    let raf = 0;
    const draw = () => {
      raf = 0;
      drawRuler(canvas, el.scrollLeft, el.clientWidth - HEADER_W, ppf);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    draw();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', schedule);
      ro.disconnect();
    };
  }, [scroller, ppf, laneWidth]);

  // 눈금을 누르거나 끌면 플레이헤드 이동
  const frameAt = (clientX: number) => {
    const rect = laneRef.current!.getBoundingClientRect();
    return Math.max(0, Math.round((clientX - rect.left) / useUI.getState().pxPerFrame));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    actions.pause();
    actions.seek(frameAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) actions.seek(frameAt(e.clientX));
  };

  return (
    <div
      ref={laneRef}
      data-testid="ruler"
      aria-label={ko.timeline.ruler}
      className="relative cursor-pointer"
      style={{ width: laneWidth, height: RULER_H }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <canvas ref={canvasRef} className="sticky block" style={{ left: HEADER_W }} />
    </div>
  );
}
