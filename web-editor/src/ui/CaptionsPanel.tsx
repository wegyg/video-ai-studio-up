/**
 * 좌측 "자막" 탭 (R20): 말소리를 인식해 자막 텍스트 클립을 만든다.
 * 모두 브라우저 안에서 돌아가고, 모델은 처음 한 번만 내려받아 캐시된다.
 */
import { useEffect, useRef, useState } from 'react';
import { CaptionJob, type CaptionProgress, type CaptionResult } from '../ai/captions-job';
import { DEFAULT_WHISPER_MODEL, whisperModel, WHISPER_MODELS, type WhisperModelId } from '../ai/whisper-protocol';
import { ko } from '../i18n/ko';
import type { CaptionStyle } from '../model/captions';
import { findClip, isMedia } from '../model/ops';
import { TEXT_PRESETS } from '../model/text-presets';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';

const CAPTION_PRESET = 'shorts-caption';

function Choice<T extends string>({ value, onChange, options, label, testId }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; disabled?: boolean }[]; label: string; testId: string }) {
  return (
    <div className="mb-3 flex gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-testid={`${testId}-${o.value}`}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={
            'flex-1 rounded-md px-2 py-1.5 text-xs disabled:opacity-40 ' +
            (value === o.value ? 'bg-cyan-600 font-bold text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CaptionsPanel() {
  const selectedId = useUI((s) => s.selectedClipId);
  const hasSelectedAudio = useProject((s) => {
    const c = selectedId ? findClip(s.edit, selectedId)?.clip : null;
    return !!c && isMedia(c) && c.type !== 'image' && (s.assets[c.assetId]?.hasAudio ?? false);
  });
  const [source, setSource] = useState<'clip' | 'all'>('all');
  const [model, setModel] = useState<WhisperModelId>(DEFAULT_WHISPER_MODEL);
  const [style, setStyle] = useState<CaptionStyle>('line');
  const [progress, setProgress] = useState<CaptionProgress | null>(null);
  const [result, setResult] = useState<CaptionResult | null>(null);
  const [error, setError] = useState('');
  const jobRef = useRef<CaptionJob | null>(null);
  useEffect(() => () => jobRef.current?.cancel(), []);

  const running = progress !== null;
  const mb = whisperModel(model).mb;

  const start = async () => {
    setResult(null);
    setError('');
    setProgress({ stage: 'audio', elapsedMs: 0 });
    const job = new CaptionJob({
      onProgress: (p) => setProgress(p),
      onDone: (r) => {
        setProgress(null);
        setResult(r);
      },
      onError: (m) => {
        setProgress(null);
        setError(m);
      },
    });
    jobRef.current = job;
    await job.run({
      clipId: source === 'clip' && hasSelectedAudio ? selectedId : null,
      model,
      style,
      textStyle: TEXT_PRESETS.find((p) => p.id === CAPTION_PRESET)?.style,
    });
  };

  const cancel = () => {
    jobRef.current?.cancel();
    setProgress(null);
  };

  const pct = progress?.total ? Math.round((progress.loaded ?? 0) / progress.total * 100) : null;
  const stageText = progress
    ? progress.stage === 'audio'
      ? ko.captions.stageAudio
      : progress.stage === 'model'
        ? pct === null
          ? ko.captions.stageModel
          : ko.captions.stageDownload(pct, Math.round((progress.total ?? 0) / 1e6))
        : progress.stage === 'transcribe'
          ? ko.captions.stageTranscribe(Math.round(progress.elapsedMs / 1000))
          : ko.captions.stageClips
    : '';

  return (
    <div data-testid="captions-panel">
      <p className="mb-3 text-[11px] leading-relaxed text-neutral-500">{ko.captions.intro}</p>
      <h3 className="mb-1 text-xs font-bold text-neutral-300">{ko.captions.source}</h3>
      <Choice
        label={ko.captions.source}
        testId="captions-source"
        value={source}
        onChange={setSource}
        options={[
          { value: 'all', label: ko.captions.sourceAll },
          { value: 'clip', label: ko.captions.sourceClip, disabled: !hasSelectedAudio },
        ]}
      />
      <h3 className="mb-1 text-xs font-bold text-neutral-300">{ko.captions.style}</h3>
      <Choice
        label={ko.captions.style}
        testId="captions-style"
        value={style}
        onChange={setStyle}
        options={[
          { value: 'line', label: ko.captions.styleLine },
          { value: 'word', label: ko.captions.styleWord },
        ]}
      />
      <h3 className="mb-1 text-xs font-bold text-neutral-300">{ko.captions.model}</h3>
      <Choice
        label={ko.captions.model}
        testId="captions-model"
        value={model}
        onChange={setModel}
        options={WHISPER_MODELS.map((m) => ({ value: m.id, label: ko.captions.models[m.id] }))}
      />
      <p className="mb-3 text-[11px] leading-relaxed text-neutral-500">{ko.captions.modelSize(mb.webgpu, mb.wasm)}</p>

      {!running && (
        <button
          type="button"
          data-testid="captions-start"
          onClick={start}
          className="w-full rounded-md bg-cyan-500 px-3 py-2 text-sm font-bold text-white hover:bg-cyan-400"
        >
          {ko.captions.start}
        </button>
      )}
      {running && (
        <div data-testid="captions-progress" className="rounded-md bg-neutral-800 p-3">
          <p className="mb-2 text-xs text-neutral-200">{stageText}</p>
          <div className="mb-2 h-1.5 overflow-hidden rounded bg-neutral-700">
            <div className={'h-full bg-cyan-400 ' + (pct === null ? 'w-1/3 animate-pulse' : '')} style={pct === null ? undefined : { width: `${pct}%` }} />
          </div>
          <button type="button" data-testid="captions-cancel" onClick={cancel} className="text-xs text-neutral-300 underline hover:text-white">
            {ko.captions.cancel}
          </button>
        </div>
      )}
      {result && (
        <div data-testid="captions-done" className="mt-3 rounded-md bg-neutral-800 p-3 text-xs text-neutral-200">
          <p>{ko.captions.done(result.clips, Math.round(result.ms / 1000))}</p>
          <p className="mt-1 text-[11px] text-neutral-400">{ko.captions.deviceInfo(result.device === 'webgpu' ? ko.captions.gpu : ko.captions.cpu)}</p>
          {result.clips === 0 && <p className="mt-1 text-[11px] text-amber-300">{ko.captions.empty}</p>}
        </div>
      )}
      {error && (
        <p data-testid="captions-error" className="mt-3 rounded-md bg-red-950 p-3 text-xs leading-relaxed text-red-100">
          {error}
        </p>
      )}
    </div>
  );
}
