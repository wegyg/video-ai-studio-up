/** 미디어 다시 연결 창 (R10.4) */
import { useRef, useState } from 'react';
import { ko } from '../i18n/ko';
import { ACCEPT } from '../media/probe';
import type { AssetMeta } from '../model/types';
import { relinkAsset, useRelink } from '../storage/relink';
import { toast } from './toasts';

function Row({ asset }: { asset: AssetMeta }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await relinkAsset(asset, file);
      if (!r.ok) toast('error', r.reason === 'kind' ? ko.relink.failKind : ko.importErrors.line(file.name, r.reason ?? ko.importErrors.unreadable));
      else if (r.warning === 'name') toast('info', ko.relink.warnName);
      else if (r.warning === 'size') toast('info', ko.relink.warnSize);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-testid="relink-item" data-asset-id={asset.id} className="flex items-center gap-2 rounded-md bg-neutral-800 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-100">{asset.name}</span>
        <span className="text-[11px] text-neutral-400">
          {ko.media.kind[asset.kind]} · {ko.relink.itemInfo(asset.size)}
        </span>
      </span>
      <button
        type="button"
        data-testid="relink-choose"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="h-7 shrink-0 rounded bg-cyan-600 px-3 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-50"
      >
        {ko.relink.choose}
      </button>
      <input
        ref={inputRef}
        data-testid="relink-input"
        type="file"
        hidden
        accept={ACCEPT}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </li>
  );
}

export function RelinkDialog() {
  const missing = useRelink((s) => s.missing);
  if (!missing.length) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" data-testid="relink-dialog" role="dialog" aria-label={ko.relink.title}>
      <div className="flex max-h-[80vh] w-[32rem] max-w-full flex-col rounded-xl bg-neutral-900 p-4 shadow-2xl">
        <h2 className="mb-1 text-base font-bold">{ko.relink.title}</h2>
        <p className="mb-3 text-xs leading-relaxed text-neutral-400">{ko.relink.description}</p>
        <ul className="mb-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {missing.map((a) => (
            <Row key={a.id} asset={a} />
          ))}
        </ul>
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="relink-later"
            onClick={() => useRelink.getState().dismiss()}
            className="h-8 rounded px-3 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            {ko.relink.later}
          </button>
        </div>
      </div>
    </div>
  );
}
