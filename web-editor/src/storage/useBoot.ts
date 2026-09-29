/** 앱이 열릴 때: 저장된 작업 되살리기 → 자동 저장 시작 → 안 쓰는 파일 정리 (R10, G4) */
import { useEffect, useState } from 'react';
import { ko } from '../i18n/ko';
import { toast } from '../ui/toasts';
import { cleanupStorage, loadLast, restore, startAutosave, storageLow } from './persist';
import { useRelink } from './relink';

export type BootState = 'restoring' | 'ready';

export function useBoot(): BootState {
  const [state, setState] = useState<BootState>('restoring');
  useEffect(() => {
    let stopAutosave: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadLast();
        if (saved && !cancelled) {
          const { missing } = await restore(saved);
          if (missing.length) {
            useRelink.getState().setMissing(missing);
            toast('error', ko.relink.missingCount(missing.length));
          }
        }
      } catch (e) {
        console.warn('[boot] 복원 실패', e);
      }
      if (cancelled) return;
      setState('ready');
      // 되살린 뒤에 정리해야 지금 쓰는 파일을 지우지 않는다
      stopAutosave = startAutosave();
      try {
        const removed = await cleanupStorage();
        if (removed.media || removed.derived) console.info('[boot] 정리', removed);
        const space = await storageLow();
        if (space?.low) toast('info', ko.storage.lowSpace);
      } catch {
        /* 정리는 실패해도 편집에 지장 없다 */
      }
    })();
    return () => {
      cancelled = true;
      stopAutosave?.();
    };
  }, []);
  return state;
}
