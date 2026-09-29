/**
 * 미디어 가져오기 (R4.1, R4.4, R10.2).
 * 파일마다: 검사(probe) → 프로젝트에 추가 → 파생 데이터 요청 → IndexedDB에 원본 저장.
 * 거부된 파일은 이름과 이유를 알림으로 보여 준다.
 */
import { ko } from '../i18n/ko';
import { newId } from '../model/ops';
import type { AssetMeta } from '../model/types';
import { isQuotaError, putMedia } from '../storage/db';
import { useProject } from '../store/project';
import { toast } from '../ui/toasts';
import { registerNewAsset } from './derive';
import { ImportError, probeFile } from './probe';

export interface ImportOutcome {
  added: string[];
  rejected: { name: string; reason: string }[];
}

export async function importFiles(files: File[]): Promise<ImportOutcome> {
  const out: ImportOutcome = { added: [], rejected: [] };
  const saves: Promise<void>[] = [];
  for (const file of files) {
    try {
      const p = await probeFile(file);
      const asset: AssetMeta = {
        id: newId('asset'),
        kind: p.kind,
        name: file.name,
        size: file.size,
        mime: file.type,
        lastModified: file.lastModified,
        durationFrames: p.durationFrames,
        width: p.width,
        height: p.height,
        hasAudio: p.hasAudio,
        hasProxy: false,
      };
      useProject.getState().addAsset(asset);
      registerNewAsset(asset, file);
      out.added.push(asset.id);
      if (p.warning) toast('info', ko.importErrors.line(file.name, p.warning));
      saves.push(
        putMedia(asset.id, file).catch((e) => {
          toast('error', ko.importErrors.line(file.name, isQuotaError(e) ? ko.importErrors.quota : ko.importErrors.storeFailed));
        }),
      );
    } catch (e) {
      const reason = e instanceof ImportError ? e.message : ko.importErrors.unreadable;
      out.rejected.push({ name: file.name, reason });
      toast('error', ko.importErrors.line(file.name, reason));
    }
  }
  await Promise.all(saves);
  return out;
}

/** 드래그 중인 것이 파일인지 (타임라인 클립/미디어 끌기와 구분) */
export const hasFiles = (dt: DataTransfer | null): boolean => !!dt && Array.from(dt.types).includes('Files');
