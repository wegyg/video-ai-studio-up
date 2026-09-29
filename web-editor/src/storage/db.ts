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
