/**
 * 타임라인 클립. 영상=필름스트립, 오디오=파형, 이미지=포스터 반복, 텍스트=내용.
 * 긴 클립도 가볍게: 캔버스는 화면에 보이는 부분만 그린다.
 */
import { memo, useLayoutEffect, useRef } from 'react';
import { ko } from '../../i18n/ko';
import { PEAKS_PER_SEC } from '../../media/derive-protocol';
import { useMedia, type Filmstrip } from '../../media/store';
import { keyOffsets, moveKeys } from '../../model/keyframes';
import { FPS, type Clip, type MediaClip } from '../../model/types';
import { useProject } from '../../store/project';
import { useUI } from '../../store/ui';
import { history } from '../../store/history';
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

/** 필름스트립: 높이 h에 맞춰 썸네일 비율을 유지하며 이어 그린다 */
function drawFilmstrip(ctx: CanvasRenderingContext2D, f: Filmstrip, clip: MediaClip, ppf: number, visL: number, w: number, h: number) {
  const tileW = (f.thumbW * h) / f.thumbH;
  const first = Math.floor(visL / tileW);
  const last = Math.ceil((visL + w) / tileW);
  for (let k = first; k < last; k++) {
    const localX = k * tileW;
    const srcSec = (clip.inPoint + localX / ppf) / FPS;
    const idx = Math.min(f.count - 1, Math.max(0, Math.floor(srcSec / f.interval)));
    const sx = (idx % f.cols) * f.thumbW;
    const sy = Math.floor(idx / f.cols) * f.thumbH;
    ctx.drawImage(f.bitmap, sx, sy, f.thumbW, f.thumbH, localX - visL, 0, tileW, h);
  }
}

/**
 * 키프레임 표시 (R16): 클립 안의 키 시각마다 ◆. 누르면 그 시각으로 이동, 끌면 그 시각의 키들을 옮긴다(끌기 한 번 = 기록 1개).
 * 끄는 동안에는 늘 시작 상태에서 다시 계산한다 → 다른 키 위를 지나가도 그 키가 지워지지 않는다(놓은 곳의 키만 대신한다).
 */
function KeyMarkers({ clip, ppf }: { clip: Clip; ppf: number }) {
  const offsets = keyOffsets(clip).filter((f) => f >= 0 && f < clip.duration);
  if (!offsets.length) return null;
  const begin = (f: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    // 끄는 동안 ◆가 새 시각 자리에 다시 그려지므로(요소가 바뀜) 이벤트는 창 전체에서 받는다
    useUI.getState().select(clip.id);
    const orig = clip;
    const x0 = e.clientX;
    let to = f;
    let moved = false;
    history.beginGesture();
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const z = useUI.getState().pxPerFrame;
      const next = Math.max(0, Math.min(orig.duration - 1, f + Math.round((ev.clientX - x0) / z)));
      if (next === to) return;
      to = next;
      useProject.getState().updateClip(orig.id, () => moveKeys(orig, f, to));
      useUI.getState().setPlayhead(orig.start + to);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      history.endGesture();
      useUI.getState().setPlayhead(orig.start + to);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  return (
    <>
      {offsets.map((f) => (
        <div
          key={f}
          data-testid="keyframe"
          data-offset={f}
          role="button"
          aria-label={ko.timeline.keyframe}
          title={ko.timeline.keyframe}
          onPointerDown={begin(f)}
          className="absolute bottom-0.5 z-[4] size-2.5 -translate-x-1/2 rotate-45 cursor-ew-resize bg-white ring-1 ring-black/70 hover:bg-cyan-300"
          style={{ left: f * ppf + ppf / 2 }}
        />
      ))}
    </>
  );
}

/** 소리가 있는 영상 클립의 아래쪽 파형 띠 높이 비율 (R4.3) */
const VIDEO_WAVE_RATIO = 0.3;

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
    const peaks = entry?.peaks;
    const s = (clip.inPoint + visL / ppf) / FPS;
    const e = peaks ? Math.min((clip.inPoint + (visL + w) / ppf) / FPS, peaks.length / PEAKS_PER_SEC + 1) : 0;
    if (clip.type === 'video') {
      // 소리가 있는 영상: 위 = 필름스트립, 아래 띠 = 파형 (R4.3)
      const waveH = peaks ? Math.round(height * VIDEO_WAVE_RATIO) : 0;
      if (entry?.filmstrip) drawFilmstrip(ctx, entry.filmstrip, clip, ppf, visL, w, height - waveH);
      if (peaks) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, height - waveH, w, waveH);
        drawPeaks(ctx, peaks, s, e, 0, height - waveH + 1, w, waveH - 2, '#5eead4');
      }
    }
    if (clip.type === 'audio' && peaks) drawPeaks(ctx, peaks, s, e, 0, 4, w, height - 8, '#7dd3fc');
  }, [clip, entry?.filmstrip, entry?.peaks, ppf, visL, w, height]);

  if (w <= 0) return null;
  return <canvas ref={ref} className="pointer-events-none absolute top-0" style={{ left: visL, width: w, height }} />;
}

/**
 * 페이드 인/아웃 표시와 핸들 (R8.2).
 * 어두운 삼각형이 소리가 작아지는 구간이고, 위쪽 동그라미를 끌어 길이를 바꾼다.
 */
function FadeOverlay({
  clip,
  ppf,
  width,
  selected,
  onBegin,
}: {
  clip: MediaClip;
  ppf: number;
  width: number;
  selected: boolean;
  onBegin: (kind: GestureKind) => (e: React.PointerEvent) => void;
}) {
  const inW = clip.fadeIn * ppf;
  const outW = clip.fadeOut * ppf;
  // 핸들은 클립 안쪽에 둔다. 경계에 걸치면 overflow-hidden에 잘려 잡히지 않는다
  const INSET = 7;
  const clampX = (x: number) => Math.min(Math.max(x, INSET), Math.max(INSET, width - INSET));
  const handle =
    'absolute top-0 z-[2] size-3 -translate-x-1/2 cursor-ew-resize rounded-full border border-neutral-900 bg-amber-300 ' +
    (selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100');
  return (
    <>
      {inW > 1 && (
        <div
          data-testid="fade-in-ramp"
          className="pointer-events-none absolute inset-y-0 left-0 bg-black/55"
          style={{ width: inW, clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
        />
      )}
      {outW > 1 && (
        <div
          data-testid="fade-out-ramp"
          className="pointer-events-none absolute inset-y-0 right-0 bg-black/55"
          style={{ width: outW, clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }}
        />
      )}
      <div
        data-testid="fade-in-handle"
        title={ko.timeline.fadeInHandle}
        aria-label={ko.timeline.fadeInHandle}
        onPointerDown={onBegin('fade-in')}
        className={handle}
        style={{ left: clampX(inW) }}
      />
      <div
        data-testid="fade-out-handle"
        title={ko.timeline.fadeOutHandle}
        aria-label={ko.timeline.fadeOutHandle}
        onPointerDown={onBegin('fade-out')}
        className={handle}
        style={{ left: clampX(width - outW) }}
      />
    </>
  );
}

export const ClipView = memo(function ClipView({ clip, rowKind, scroller }: { clip: Clip; rowKind: keyof typeof ROW_H; scroller: HTMLDivElement | null }) {
  const ppf = useUI((s) => s.pxPerFrame);
  const selected = useUI((s) => s.selectedClipId === clip.id);
  const assetName = useProject((s) => (clip.type === 'text' ? '' : (s.assets[clip.assetId]?.name ?? '')));
  const hasAudio = useProject((s) => (clip.type === 'text' ? false : (s.assets[clip.assetId]?.hasAudio ?? false)));
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
        'group absolute cursor-grab overflow-hidden rounded-md ring-1 active:cursor-grabbing ' +
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
      {hasAudio && clip.type !== 'text' && clip.volume !== 1 && (
        <span
          data-testid="clip-volume-badge"
          className="pointer-events-none absolute right-2 bottom-0.5 rounded bg-black/60 px-1 text-[10px] tabular-nums text-amber-200"
        >
          {Math.round(clip.volume * 100)}
          {ko.inspector.units.percent}
        </span>
      )}
      {hasAudio && <FadeOverlay clip={clip as MediaClip} ppf={ppf} width={width} selected={selected} onBegin={begin} />}
      <KeyMarkers clip={clip} ppf={ppf} />
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
