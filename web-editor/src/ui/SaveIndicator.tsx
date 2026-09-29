/** 저장 상태 표시 + 프로젝트 파일 저장/열기 (R10.1, R10.4, R10.5) */
import { useEffect, useRef, useState } from 'react';
import { ko } from '../i18n/ko';
import { loadStoredAsset } from '../media/derive';
import { onSaveState, restore } from '../storage/persist';
import { downloadProjectJson, parseProjectFile, ProjectFileError, toSavedProject } from '../storage/project-json';
import { useRelink } from '../storage/relink';
import { IconDownload, IconFolderOpen } from './icons';
import { toast } from './toasts';

type Shown = 'none' | 'saving' | 'saved' | 'error';

export function SaveIndicator() {
  const [shown, setShown] = useState<Shown>('none');
  const hideTimer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onSaveState((s, message) => {
      clearTimeout(hideTimer.current);
      if (s === 'saving') setShown('saving');
      else if (s === 'saved') {
        setShown('saved');
        hideTimer.current = window.setTimeout(() => setShown('none'), 1500);
      } else if (s === 'error') {
        setShown('error');
        toast('error', message === 'quota' ? ko.storage.quota : ko.storage.saveFailed);
      }
    });
    return () => {
      onSaveState(null);
      clearTimeout(hideTimer.current);
    };
  }, []);

  const open = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseProjectFile(await file.text());
      const { missing } = await restore(toSavedProject(parsed));
      // 원본이 없으면 다시 연결 창을 띄운다
      if (missing.length) useRelink.getState().setMissing(missing);
      else await Promise.all(Object.values(parsed.project.assets).map((a) => loadStoredAsset(a)));
    } catch (e) {
      const key = e instanceof ProjectFileError ? (e.message as keyof typeof ko.storage.importErrors) : 'broken';
      toast('error', ko.storage.importErrors[key] ?? ko.storage.importErrors.broken);
    }
  };

  return (
    <>
      <span data-testid="save-state" data-state={shown} className="w-14 text-right text-[11px] text-neutral-500">
        {shown === 'saving' ? ko.storage.saving : shown === 'saved' ? ko.storage.saved : shown === 'error' ? ko.storage.saveFailed : ''}
      </span>
      <button
        type="button"
        data-testid="export-json"
        aria-label={ko.storage.exportJson}
        title={ko.storage.exportJson}
        onClick={() => toast('info', ko.storage.exported(downloadProjectJson()))}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-neutral-300 hover:bg-neutral-800"
      >
        <IconDownload />
      </button>
      <button
        type="button"
        data-testid="import-json"
        aria-label={ko.storage.importJson}
        title={ko.storage.importJson}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-neutral-300 hover:bg-neutral-800"
      >
        <IconFolderOpen />
      </button>
      <input
        ref={inputRef}
        data-testid="import-json-input"
        type="file"
        hidden
        accept=".json,application/json"
        onChange={(e) => {
          void open(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );
}
