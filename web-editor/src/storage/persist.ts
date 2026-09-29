/**
 * 자동 저장과 복원 (R10.1, R10.3, 완료 기준 G4).
 *
 * - 편집이 바뀌면 400ms 뒤에 IndexedDB에 저장한다(요구사항은 1초 이내).
 * - 탭이 가려지거나 닫히려 할 때 곧바로 한 번 더 저장한다.
 * - 새로고침하면 마지막 프로젝트를 되살리고, 미디어 원본도 IndexedDB에서 다시 연결한다.
 */
import { loadStoredAsset } from '../media/derive';
import type { AssetMeta } from '../model/types';
import { useProject, type ProjectSnapshot } from '../store/project';
import { useUI } from '../store/ui';
import { allProjects, getMeta, getProject, isQuotaError, putMeta, putProject, storageEstimate, deleteUnreferenced } from './db';

export const SAVE_DEBOUNCE_MS = 400;
const LAST_ID = 'lastProjectId';

/** 저장 형식. version은 앞으로 형식이 바뀔 때 구분하려고 둔다. */
export interface SavedProject {
  version: 1;
  project: ProjectSnapshot;
  /** 화면 상태(되살리면 편하지만 편집 내용은 아님) */
  view: { playhead: number; pxPerFrame: number; snap: boolean; safeArea: boolean };
  updatedAt: number;
}

export function snapshot(): SavedProject {
  const p = useProject.getState();
  const u = useUI.getState();
  return {
    version: 1,
    project: { id: p.id, name: p.name, assets: p.assets, edit: p.edit },
    view: { playhead: u.playhead, pxPerFrame: u.pxPerFrame, snap: u.snap, safeArea: u.safeArea },
    updatedAt: Date.now(),
  };
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
let onState: ((s: SaveState, message?: string) => void) | null = null;
export function onSaveState(fn: ((s: SaveState, message?: string) => void) | null): void {
  onState = fn;
}

let saving: Promise<void> | null = null;
let savedCount = 0;
export const savedTimes = () => savedCount;

export async function saveNow(): Promise<void> {
  if (saving) await saving.catch(() => undefined);
  const data = snapshot();
  onState?.('saving');
  saving = (async () => {
    try {
      await putProject(data.project.id, data);
      await putMeta(LAST_ID, data.project.id);
      savedCount++;
      onState?.('saved');
    } catch (e) {
      onState?.('error', isQuotaError(e) ? 'quota' : 'failed');
      throw e;
    } finally {
      saving = null;
    }
  })();
  return saving;
}

/** 자동 저장 시작. 반환값을 부르면 멈춘다. */
export function startAutosave(): () => void {
  let timer: number | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void saveNow().catch(() => undefined), SAVE_DEBOUNCE_MS);
  };
  const unsubProject = useProject.subscribe((s, p) => {
    if (s.edit !== p.edit || s.assets !== p.assets || s.name !== p.name || s.id !== p.id) schedule();
  });
  const unsubUI = useUI.subscribe((s, p) => {
    if (s.playhead !== p.playhead || s.pxPerFrame !== p.pxPerFrame || s.snap !== p.snap || s.safeArea !== p.safeArea) schedule();
  });
  // 탭을 닫거나 다른 탭으로 옮길 때 바로 저장 (마지막 편집을 잃지 않게)
  const flush = () => {
    clearTimeout(timer);
    void saveNow().catch(() => undefined);
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    clearTimeout(timer);
    unsubProject();
    unsubUI();
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onHide);
  };
}

export async function loadLast(): Promise<SavedProject | null> {
  const id = await getMeta<string>(LAST_ID);
  if (!id) return null;
  const saved = await getProject<SavedProject>(id);
  return saved?.version === 1 ? saved : null;
}

/**
 * 저장된 프로젝트를 화면에 되살린다.
 * 미디어 원본이 IndexedDB에 없으면 missing으로 돌려주고, 화면에서 다시 연결하게 한다(R10.4).
 */
export async function restore(saved: SavedProject): Promise<{ missing: AssetMeta[] }> {
  useProject.getState().replaceProject(saved.project);
  const u = useUI.getState();
  u.setPlayhead(saved.view.playhead);
  u.setZoom(saved.view.pxPerFrame);
  u.setSnap(saved.view.snap);
  u.setSafeArea(saved.view.safeArea);
  u.select(null);
  const missing: AssetMeta[] = [];
  for (const asset of Object.values(saved.project.assets)) {
    if (!(await loadStoredAsset(asset))) missing.push(asset);
  }
  return { missing };
}

/** 저장된 어떤 프로젝트도 쓰지 않는 원본·파생 데이터를 지운다 */
export async function cleanupStorage(): Promise<{ media: number; derived: number }> {
  const projects = await allProjects<SavedProject>();
  const referenced = new Set<string>();
  for (const p of projects) for (const id of Object.keys(p.project?.assets ?? {})) referenced.add(id);
  return deleteUnreferenced(referenced);
}

/** 남은 공간이 적은지 (10% 미만 또는 50MB 미만) */
export async function storageLow(): Promise<{ usage: number; quota: number; low: boolean } | null> {
  const e = await storageEstimate();
  if (!e || !e.quota) return null;
  const free = e.quota - e.usage;
  return { ...e, low: free < Math.min(e.quota * 0.1, 50 * 1024 * 1024) };
}
