/**
 * "미디어 다시 연결" 상태 (R10.4).
 * JSON으로 가져온 프로젝트나 지워진 원본 때문에 파일이 없을 때, 사용자가 직접 파일을 골라 붙인다.
 */
import { create } from 'zustand';
import { registerNewAsset } from '../media/derive';
import { probeFile } from '../media/probe';
import type { AssetMeta } from '../model/types';
import { useProject } from '../store/project';
import { putMedia } from './db';

interface RelinkState {
  missing: AssetMeta[];
  setMissing: (list: AssetMeta[]) => void;
  dismiss: () => void;
}

export const useRelink = create<RelinkState>()((set) => ({
  missing: [],
  setMissing: (list) => set({ missing: list }),
  dismiss: () => set({ missing: [] }),
}));

export interface RelinkResult {
  ok: boolean;
  /** 이름이나 크기가 다르면 알려 준다 (그래도 연결은 해 준다) */
  warning?: 'name' | 'size';
  reason?: string;
}

/** 고른 파일을 이 자산에 붙인다. 길이/크기 정보는 새 파일 기준으로 갱신한다. */
export async function relinkAsset(asset: AssetMeta, file: File): Promise<RelinkResult> {
  let probed;
  try {
    probed = await probeFile(file);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : undefined };
  }
  if (probed.kind !== asset.kind) return { ok: false, reason: 'kind' };

  const next: AssetMeta = {
    ...asset,
    name: file.name,
    size: file.size,
    mime: file.type,
    lastModified: file.lastModified,
    durationFrames: probed.durationFrames ?? asset.durationFrames,
    width: probed.width ?? asset.width,
    height: probed.height ?? asset.height,
    hasAudio: probed.hasAudio,
  };
  useProject.getState().updateAsset(asset.id, next);
  await putMedia(asset.id, file);
  registerNewAsset(next, file);
  useRelink.setState((s) => ({ missing: s.missing.filter((m) => m.id !== asset.id) }));
  const warning = file.name !== asset.name ? 'name' : file.size !== asset.size ? 'size' : undefined;
  return { ok: true, warning };
}
