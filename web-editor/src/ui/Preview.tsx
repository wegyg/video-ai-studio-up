import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { actions } from '../actions';
import { PreviewEngine, previewRef } from '../engine/preview/PreviewEngine';
import { ko, withKey } from '../i18n/ko';
import { editDuration, formatTimecode } from '../model/time';
import { RATIO_SIZE, RATIOS } from '../model/types';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import { IconButton } from './common';
import { IconPause, IconPlay } from './icons';

/** 무대 크기 안에 프로젝트 비율 그대로 들어가는 최대 크기 */
function useFittedBox(width: number, height: number) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      const aw = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ah = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const s = Math.max(0, Math.min(aw / width, ah / height));
      setBox({ w: Math.floor(width * s), h: Math.floor(height * s) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);
  return { stageRef, box };
}

function RatioSwitch() {
  const ratio = useProject((s) => s.edit.ratio);
  return (
    <div role="radiogroup" aria-label={ko.preview.ratio} className="flex gap-1 rounded-lg bg-neutral-900 p-0.5">
      {RATIOS.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={ratio === r}
          aria-label={ko.ratios[r]}
          title={ko.ratios[r]}
          onClick={() => actions.setRatio(r)}
          className={
            'rounded-md px-2.5 py-1 text-xs tabular-nums ' +
            (ratio === r ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-neutral-200')
          }
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function TimeDisplay() {
  const playhead = useUI((s) => s.playhead);
  const total = useProject((s) => editDuration(s.edit));
  return (
    <div className="font-mono text-sm tabular-nums">
      <span data-testid="time-current" aria-label={ko.preview.currentTime} className="text-cyan-300">
        {formatTimecode(playhead)}
      </span>
      <span className="px-1.5 text-neutral-500">/</span>
      <span data-testid="time-total" aria-label={ko.preview.totalTime} className="text-neutral-400">
        {formatTimecode(total)}
      </span>
    </div>
  );
}

function PlayButton() {
  const playing = useUI((s) => s.playing);
  const label = playing ? ko.preview.pause : ko.preview.play;
  return (
    <IconButton label={label} tooltip={withKey(label, ko.keys.play)} onClick={actions.togglePlay} testId="play" className="size-9">
      {playing ? <IconPause className="size-5" /> : <IconPlay className="size-5" />}
    </IconButton>
  );
}

/** 미리보기 엔진을 캔버스에 붙이고, 상자 크기가 바뀌면 캔버스 해상도를 맞춘다 */
function usePreviewEngine(box: { w: number; h: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  useEffect(() => {
    const e = new PreviewEngine(canvasRef.current!);
    engineRef.current = e;
    previewRef.current = e;
    return () => {
      e.dispose();
      if (previewRef.current === e) previewRef.current = null;
      engineRef.current = null;
    };
  }, []);
  useEffect(() => {
    engineRef.current?.resize(box.w, box.h, window.devicePixelRatio || 1);
  }, [box]);
  return canvasRef;
}

export function Preview() {
  const ratio = useProject((s) => s.edit.ratio);
  const { width, height } = RATIO_SIZE[ratio];
  const { stageRef, box } = useFittedBox(width, height);
  const canvasRef = usePreviewEngine(box);
  return (
    <section aria-label={ko.preview.region} className="flex min-w-0 flex-1 flex-col bg-neutral-950">
      <div className="flex h-10 shrink-0 items-center justify-center">
        <RatioSwitch />
      </div>
      <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
        <div
          data-testid="preview-frame"
          data-ratio={ratio}
          className="relative bg-black shadow-lg shadow-black/50"
          style={{ width: box.w, height: box.h }}
        >
          <canvas ref={canvasRef} data-testid="preview-canvas" className="absolute inset-0 block h-full w-full" />
        </div>
      </div>
      <div className="flex h-11 shrink-0 items-center justify-center gap-4 border-t border-neutral-800">
        <TimeDisplay />
        <PlayButton />
      </div>
    </section>
  );
}
