/** 미디어 패널: 가져오기(버튼, 끌어다 놓기), 썸네일 목록. 썸네일은 타임라인으로 끌어 넣을 수 있다(태스크 4). */
import { useRef, useState, type DragEvent } from 'react';
import { actions } from '../actions';
import { ko } from '../i18n/ko';
import { hasFiles, importFiles } from '../media/import';
import { ACCEPT, ACCEPT_AUDIO } from '../media/probe';
import { useMedia } from '../media/store';
import { formatTimecode } from '../model/time';
import type { AssetMeta } from '../model/types';
import { useProject } from '../store/project';
import { IconFilm, IconImage, IconMusic, IconPlus, IconUpload } from './icons';
import { assetDrag } from './timeline/view';
import { Waveform } from './waveform';

/** 타임라인으로 끌 때 dataTransfer 형식 */
export const ASSET_DRAG_TYPE = 'application/x-editor-asset';

function MediaTile({ asset }: { asset: AssetMeta }) {
  const entry = useMedia((s) => s.entries[asset.id]);
  const status = entry?.status ?? 'loading';
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
    e.dataTransfer.effectAllowed = 'copy';
    assetDrag.id = asset.id;
  };
  const onDragEnd = () => {
    assetDrag.id = null;
  };
  const Icon = asset.kind === 'video' ? IconFilm : asset.kind === 'image' ? IconImage : IconMusic;
  return (
    <div
      data-testid="media-item"
      data-asset-id={asset.id}
      data-kind={asset.kind}
      data-status={status}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={asset.name}
      className="group relative cursor-grab overflow-hidden rounded-md bg-neutral-800 ring-1 ring-neutral-700/60 hover:ring-cyan-500/60"
    >
      <div className="relative flex aspect-video items-center justify-center bg-black">
        {entry?.posterUrl ? (
          <img src={entry.posterUrl} alt={asset.name} draggable={false} className="h-full w-full object-contain" />
        ) : entry?.peaks ? (
          <Waveform peaks={entry.peaks} className="h-3/4 w-full" />
        ) : (
          <Icon className="size-6 text-neutral-500" />
        )}
        {asset.durationFrames !== undefined && (
          <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[10px] text-neutral-200">
            {formatTimecode(asset.durationFrames).slice(0, 5)}
          </span>
        )}
        <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-[10px] text-neutral-300 group-hover:opacity-0">
          {ko.media.kind[asset.kind]}
        </span>
        <button
          type="button"
          data-testid="remove-asset"
          aria-label={ko.media.remove(asset.name)}
          title={ko.media.remove(asset.name)}
          onClick={() => useProject.getState().removeAsset(asset.id)}
          className="absolute top-1 left-1 flex size-6 items-center justify-center rounded-full bg-neutral-900/80 text-neutral-200 opacity-0 hover:bg-red-600 group-hover:opacity-100 focus:opacity-100"
        >
          ✕
        </button>
        <button
          type="button"
          data-testid="add-to-timeline"
          aria-label={ko.media.addToTimeline}
          title={ko.media.addToTimeline}
          onClick={() => actions.addAssetToTimeline(asset.id)}
          className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-cyan-500 text-white opacity-0 shadow group-hover:opacity-100 focus:opacity-100"
        >
          <IconPlus className="size-3.5" />
        </button>
        {status === 'loading' && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-neutral-700" aria-label={ko.media.preparing}>
            <div className="h-full bg-cyan-400 transition-[width]" style={{ width: `${Math.round((entry?.progress ?? 0) * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="truncate px-1.5 py-1 text-[11px] text-neutral-300">{asset.name}</div>
    </div>
  );
}

export function MediaPanel({ audioOnly = false }: { audioOnly?: boolean }) {
  const assets = useProject((s) => s.assets);
  const list = Object.values(assets).filter((a) => !audioOnly || a.kind === 'audio');
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);

  const run = async (files: File[]) => {
    if (!files.length) return;
    setBusy((b) => b + 1);
    try {
      await importFiles(files);
    } finally {
      setBusy((b) => b - 1);
    }
  };

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    setOver(false);
    void run(Array.from(e.dataTransfer.files));
  };

  const label = audioOnly ? ko.audioPanel.import : ko.media.import;
  return (
    <div
      data-testid="media-dropzone"
      className="relative flex min-h-full flex-col gap-3"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        data-testid="import-button"
        onClick={() => inputRef.current?.click()}
        className="flex h-9 items-center justify-center gap-2 rounded-md bg-cyan-600 text-sm font-bold text-white hover:bg-cyan-500"
      >
        <IconUpload />
        {busy ? ko.media.importing : label}
      </button>
      <input
        ref={inputRef}
        data-testid="import-input"
        type="file"
        multiple
        hidden
        accept={audioOnly ? ACCEPT_AUDIO : ACCEPT}
        onChange={(e) => {
          void run(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      {list.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-sm leading-relaxed text-neutral-400">{audioOnly ? ko.audioPanel.empty : ko.media.empty}</p>
          {!audioOnly && <p className="mt-3 text-xs text-neutral-500">{ko.media.formats}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2" data-testid="media-grid">
          {list.map((a) => (
            <MediaTile key={a.id} asset={a} />
          ))}
        </div>
      )}
      {over && (
        <div
          data-testid="drop-overlay"
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-cyan-400 bg-cyan-500/10 text-sm font-bold text-cyan-200"
        >
          {ko.media.dropHere}
        </div>
      )}
    </div>
  );
}
