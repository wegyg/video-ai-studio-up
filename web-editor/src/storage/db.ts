/**
 * IndexedDB (idb 8). 데이터베이스 `web-editor` v1
 *  - projects: 프로젝트 JSON (태스크 9)
 *  - media:    가져온 원본 파일 (Blob/File) — 새로고침 후에도 다시 가져올 필요 없음 (R10.2)
 *  - derived:  원본에서 만든 데이터 — `${assetId}:poster` | `:filmstrip` | `:peaks`
 *  - meta:     기타 값 (예: lastProjectId)
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface FilmstripRecord {
  blob: Blob;
  count: number;
  /** 썸네일 간격(초) */
  interval: number;
  thumbW: number;
  thumbH: number;
  cols: number;
}

export type DerivedValue = Blob | FilmstripRecord | Float32Array;

interface EditorDB extends DBSchema {
  projects: { key: string; value: unknown };
  media: { key: string; value: Blob };
  derived: { key: string; value: DerivedValue };
  meta: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<EditorDB>> | null = null;

export function db(): Promise<IDBPDatabase<EditorDB>> {
  dbp ??= openDB<EditorDB>('web-editor', 1, {
    upgrade(d) {
      d.createObjectStore('projects');
      d.createObjectStore('media');
      d.createObjectStore('derived');
      d.createObjectStore('meta');
    },
  });
  return dbp;
}

/** 저장 공간 부족 오류인지 */
export const isQuotaError = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');

export async function putMedia(id: string, blob: Blob): Promise<void> {
  await (await db()).put('media', blob, id);
}
export async function getMedia(id: string): Promise<Blob | undefined> {
  return (await db()).get('media', id);
}
export async function listMediaSizes(): Promise<{ id: string; size: number; name: string }[]> {
  const d = await db();
  const keys = await d.getAllKeys('media');
  const out = [];
  for (const id of keys) {
    const b = await d.get('media', id);
    out.push({ id, size: b?.size ?? -1, name: b instanceof File ? b.name : '' });
  }
  return out;
}

export async function putDerived(key: string, value: DerivedValue): Promise<void> {
  await (await db()).put('derived', value, key);
}
export async function getDerived<T extends DerivedValue>(key: string): Promise<T | undefined> {
  return (await db()).get('derived', key) as Promise<T | undefined>;
}

// --- 프로젝트 / 기타 값 -----------------------------------------------------

export async function putProject(id: string, value: unknown): Promise<void> {
  await (await db()).put('projects', value, id);
}
export async function getProject<T>(id: string): Promise<T | undefined> {
  return (await db()).get('projects', id) as Promise<T | undefined>;
}
export async function allProjects<T>(): Promise<T[]> {
  return (await db()).getAll('projects') as Promise<T[]>;
}
export async function putMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get('meta', key) as Promise<T | undefined>;
}

/** 어떤 프로젝트도 쓰지 않는 원본·파생 데이터를 지운다 */
export async function deleteUnreferenced(referenced: Set<string>): Promise<{ media: number; derived: number }> {
  const d = await db();
  let media = 0;
  let derived = 0;
  for (const key of await d.getAllKeys('media')) {
    if (!referenced.has(String(key))) {
      await d.delete('media', key);
      media++;
    }
  }
  for (const key of await d.getAllKeys('derived')) {
    if (!referenced.has(String(key).split(':')[0])) {
      await d.delete('derived', key);
      derived++;
    }
  }
  return { media, derived };
}

/** 남은 저장 공간 (브라우저가 알려 주지 않으면 null) */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
