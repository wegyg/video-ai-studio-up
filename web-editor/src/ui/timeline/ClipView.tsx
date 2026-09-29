/**
 * 타임라인 클립. 영상=필름스트립, 오디오=파형, 이미지=포스터 반복, 텍스트=내용.
 * 긴 클립도 가볍게: 캔버스는 화면에 보이는 부분만 그린다.
 */
import { memo, useLayoutEffect, useRef } from 'react';
import { PEAKS_PER_SEC } from '../../media/derive-protocol';
import { useMedia, type Filmstrip } from '../../media/store';
import { FPS, type Clip, type MediaClip } from '../../model/types';
import { useProject } from '../../store/project';
import { useUI } from '../../store/ui';
import { drawPeaks } from '../waveform';
import { startClipGesture, type GestureKind } from './gestures';
import { ROW_H } from './layout';
import { useTimelineView } from './view';

const PAD_Y = 4;
const TYPE_STYLE: Record<Clip['type'], string> = {
  video: 'bg-teal-900/80 ring-teal-500/70',
  image: 'bg-violet-900/80 ring-violet-500/70',
  audio: 'bg-sky-950/90 ring-sky-500/70',
  text: 'bg-amber-900/80 ring-amber-500/70',
};

function drawFilmstrip(ctx: CanvasRenderingContext2D, f: Filmstrip, clip: MediaClip, ppf: number, visL: number, w: number, h: number) {
  const first = Math.floor(visL / f.thumbW);
  const last = Math.ceil((visL + w) / f.thumbW);
  for (let k = first; k < last; k++) {
    const localX = k * f.thumbW;
    const srcSec = (clip.inPoint + localX / ppf) / FPS;
    const idx = Math.min(f.count - 1, Math.max(0, Math.floor(srcSec / f.interval)));
    const sx = (idx % f.cols) * f.thumbW;
    const sy = Math.floor(idx / f.cols) * f.thumbH;
    ctx.drawImage(f.bitmap, sx, sy, f.thumbW, f.thumbH, localX - visL, 0, f.thumbW, h);
  }
}

/** 보이는 부분만 그리는 캔버스 (영상: 필름스트립, 오디오: 파형) */
function ClipCanvas({ clip, width, height }: { clip: MediaClip; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const entry = useMedia((s) => s.entries[clip.assetId]);
  const ppf = useUI((s) => s.pxPerFrame);
  const scrollLeft = useTimelineView((s) => s.scrollLeft);
  const viewW = useTimelineView((s) => s.viewW);
  const x0 = clip.start * ppf;
  const visL = Math.max(0, scrollLeft - 64 - x0);
  const visR = Math.min(width, scrollLeft + viewW + 64 - x0);
  const w = Math.max(0, Math.floor(visR - visL));

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || w <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    if (clip.type === 'video' && entry?.filmstrip) drawFilmstrip(ctx, entry.filmstrip, clip, ppf, visL, w, height);
    if (clip.type === 'audio' && entry?.peaks) {
      const s = (clip.inPoint + visL / ppf) / FPS;
      const e = (clip.inPoint + (visL + w) / ppf) / FPS;
      drawPeaks(ctx, entry.peaks, s, Math.min(e, entry.peaks.length / PEAKS_PER_SEC + 1), 0, 4, w, height - 8, '#7dd3fc');
    }
  }, [clip, entry?.filmstrip, entry?.peaks, ppf, visL, w, height]);

  if (w <= 0) return null;
  return <canvas ref={ref} className="pointer-events-none absolute top-0" style={{ left: visL, width: w, height }} />;
}

export const ClipView = memo(function ClipView({ clip, rowKind, scroller }: { clip: Clip; rowKind: keyof typeof ROW_H; scroller: HTMLDivElement | null }) {
  const ppf = useUI((s) => s.pxPerFrame);
  const selected = useUI((s) => s.selectedClipId === clip.id);
  const assetName = useProject((s) => (clip.type === 'text' ? '' : (s.assets[clip.assetId]?.name ?? '')));
  const posterUrl = useMedia((s) => (clip.type === 'image' ? s.entries[clip.assetId]?.posterUrl : undefined));
  const width = Math.max(2, clip.duration * ppf);
  const height = ROW_H[rowKind] - PAD_Y * 2;

  const begin = (kind: GestureKind) => (e: React.PointerEvent) => {
    if (e.button !== 0 || !scroller) return;
    e.stopPropagation();
    useUI.getState().select(clip.id);
    startClipGesture(e, clip.id, kind, scroller);
  };

  return (
    <div
      data-testid="clip"
      data-clip-id={clip.id}
      data-type={clip.type}
      data-selected={selected}
      onPointerDown={begin('move')}
      className={
        'absolute cursor-grab overflow-hidden rounded-md ring-1 active:cursor-grabbing ' +
        TYPE_STYLE[clip.type] +
        (selected ? ' z-[5] ring-2 ring-white' : '')
      }
      style={{
        top: PAD_Y,
        height,
        width,
        transform: `translateX(${clip.start * ppf}px)`,
        backgroundImage: posterUrl ? `url(${posterUrl})` : undefined,
        backgroundSize: 'auto 100%',
        backgroundRepeat: 'repeat-x',
      }}
    >
      {clip.type !== 'text' && clip.type !== 'image' && <ClipCanvas clip={clip} width={width} height={height} />}
      <span className="pointer-events-none absolute top-0.5 left-2 max-w-[calc(100%-1rem)] truncate rounded bg-black/40 px-1 text-[10px] text-white/90">
        {clip.type === 'text' ? clip.text : assetName}
      </span>
      <div
        data-testid="trim-start"
        onPointerDown={begin('trim-start')}
        className={'absolute inset-y-0 left-0 w-2 cursor-ew-resize ' + (selected ? 'bg-white/80' : 'hover:bg-white/40')}
      />
      <div
        data-testid="trim-end"
        onPointerDown={begin('trim-end')}
        className={'absolute inset-y-0 right-0 w-2 cursor-ew-resize ' + (selected ? 'bg-white/80' : 'hover:bg-white/40')}
      />
    </div>
  );
});
