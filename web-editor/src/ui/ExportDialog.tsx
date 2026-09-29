/** 내보내기 창 (R11.5~R11.7): 진행률·경과·남은 시간·취소, 끝나면 걸린 시간 표시 */
import { useEffect, useRef, useState } from 'react';
import { ExportJob, type ExportProgress, type ExportResult } from '../engine/export';
import { ko } from '../i18n/ko';
import { editDuration } from '../model/time';
import { FPS, RATIO_SIZE } from '../model/types';
import { useProject } from '../store/project';
import { workElapsedMinutes } from '../storage/work-timer';
import { toast } from './toasts';

type Phase = 'idle' | 'running' | 'done' | 'error';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`;
};

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const ratio = useProject((s) => s.edit.ratio);
  const totalFrames = useProject((s) => editDuration(s.edit));
  const { width, height } = RATIO_SIZE[ratio];
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string>('');
  const jobRef = useRef<ExportJob | null>(null);

  useEffect(() => () => jobRef.current?.cancel(), []);

  const start = async () => {
    setPhase('running');
    setProgress(null);
    const job = new ExportJob({
      onProgress: setProgress,
      onDone: (r) => {
        setPhase('done');
        setResult(r);
        toast('info', r.downloaded ? ko.exportPanel.downloaded(r.fileName) : ko.exportPanel.savedToFile(r.fileName));
      },
      onCanceled: () => {
        setPhase('idle');
        setProgress(null);
      },
      onError: (message, code) => {
        setPhase('error');
        setError(code === 'no-avc' || message === 'avc' ? ko.exportPanel.errorNoAvc : message === 'empty' ? ko.exportPanel.empty : ko.exportPanel.errorOther(message));
      },
    });
    jobRef.current = job;
    await job.start();
  };

  const pct = progress ? Math.round(progress.ratio * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" data-testid="export-dialog" role="dialog" aria-label={ko.exportPanel.title}>
      <div className="w-[26rem] max-w-full rounded-xl bg-neutral-900 p-5 shadow-2xl">
        <h2 className="mb-1 text-base font-bold">{ko.exportPanel.title}</h2>
        <p className="mb-4 text-xs text-neutral-400">{ko.exportPanel.info(width, height, totalFrames / FPS)}</p>

        {phase === 'running' && (
          <div className="mb-4">
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-neutral-300">{ko.exportPanel.stages[progress?.stage ?? 'prepare']}</span>
              <span data-testid="export-percent" className="font-mono text-lg tabular-nums text-cyan-300">
                {pct}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
              <div data-testid="export-bar" className="h-full bg-cyan-400 transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <dl className="mt-2 flex justify-between text-[11px] text-neutral-400">
              <div>
                <dt className="inline">{ko.exportPanel.elapsed} </dt>
                <dd className="inline tabular-nums">{fmt(progress?.elapsedMs ?? 0)}</dd>
              </div>
              <div>
                <dt className="inline">{ko.exportPanel.eta} </dt>
                <dd data-testid="export-eta" className="inline tabular-nums">
                  {progress?.etaMs === null || progress?.etaMs === undefined ? '—' : fmt(progress.etaMs)}
                </dd>
              </div>
            </dl>
            {progress && <p className="mt-1 text-[11px] text-neutral-500">{ko.exportPanel.progress(progress.frames, progress.total)}</p>}
            <p className="mt-2 text-[11px] text-amber-300/80">{ko.exportPanel.keepOpen}</p>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="mb-4 rounded-lg bg-neutral-800 p-3" data-testid="export-done">
            <p className="text-sm font-bold text-cyan-300">{ko.exportPanel.doneTitle}</p>
            <p data-testid="export-summary" className="mt-1 text-sm tabular-nums text-neutral-100">
              {ko.exportPanel.doneSummary(result.seconds, result.ms)}
            </p>
            <p className="text-xs text-neutral-400">{ko.exportPanel.doneSize(result.bytes)}</p>
            <p data-testid="work-elapsed" className="mt-1 text-xs text-neutral-500">
              {ko.exportPanel.workElapsed(workElapsedMinutes())}
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="mb-4 rounded-lg bg-red-950 p-3 text-sm text-red-100" data-testid="export-error">
            <p className="font-bold">{ko.exportPanel.errorTitle}</p>
            <p className="mt-1 text-xs leading-relaxed">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {phase === 'running' ? (
            <button
              type="button"
              data-testid="export-cancel"
              onClick={() => jobRef.current?.cancel()}
              className="h-9 rounded-md bg-neutral-700 px-4 text-sm text-white hover:bg-neutral-600"
            >
              {ko.exportPanel.cancel}
            </button>
          ) : (
            <>
              <button type="button" data-testid="export-close" onClick={onClose} className="h-9 rounded-md px-4 text-sm text-neutral-300 hover:bg-neutral-800">
                {ko.exportPanel.close}
              </button>
              <button
                type="button"
                data-testid="export-start"
                disabled={totalFrames <= 0}
                onClick={() => void start()}
                className="h-9 rounded-md bg-cyan-600 px-4 text-sm font-bold text-white hover:bg-cyan-500 disabled:opacity-40"
              >
                {ko.exportPanel.start}
              </button>
            </>
          )}
        </div>
        {totalFrames <= 0 && <p className="mt-2 text-right text-[11px] text-neutral-500">{ko.exportPanel.empty}</p>}
      </div>
    </div>
  );
}
