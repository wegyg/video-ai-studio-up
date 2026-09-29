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
  const d = await db();
  await d.put('media', blob, id);
  // 넣은 시각을 적어 둔다 → 정리할 때 "방금 넣은 것"을 지우지 않게 (새로고침 경합으로 원본을 잃는 일 방지)
  await d.put('meta', Date.now(), `mediaAddedAt:${id}`);
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

/** 이보다 최근에 넣은 원본은 프로젝트 목록에 없어도 지우지 않는다 (저장이 채 끝나기 전 새로고침 대비) */
export const MEDIA_GRACE_MS = 24 * 60 * 60 * 1000;

/** 사용자가 목록에서 지운 미디어라고 적어 둔다 → 되살리기 대상에서 빠진다 (원본은 하루 뒤 정리) */
export async function markMediaRemoved(id: string): Promise<void> {
  await (await db()).put('meta', Date.now(), `mediaRemovedAt:${id}`);
}

/** 어느 프로젝트에도 없는 최근 원본 (새로고침 경합으로 목록에서만 빠진 것). 사용자가 지운 것은 빼고 */
export async function recentOrphans(referenced: Set<string>, withinMs: number): Promise<{ id: string; blob: Blob }[]> {
  const d = await db();
  const now = Date.now();
  const out: { id: string; blob: Blob }[] = [];
  for (const key of await d.getAllKeys('media')) {
    const id = String(key);
    if (referenced.has(id)) continue;
    if ((await d.get('meta', `mediaRemovedAt:${id}`)) !== undefined) continue;
    const addedAt = (await d.get('meta', `mediaAddedAt:${id}`)) as number | undefined;
    if (addedAt === undefined || now - addedAt > withinMs) continue;
    const blob = await d.get('media', key);
    if (blob) out.push({ id, blob });
  }
  return out;
}

/**
 * 어떤 프로젝트도 쓰지 않는 원본·파생 데이터를 지운다.
 * 단, 최근(MEDIA_GRACE_MS 이내)에 넣은 원본은 남긴다 — 넣자마자 새로고침하면 프로젝트 저장보다
 * 정리가 먼저 돌 수 있는데, 그때 방금 넣은 원본을 지우면 사용자는 파일을 잃는다.
 * `protect`에 든 id도 남긴다 (지금 화면에 열려 있는 프로젝트의 미디어).
 */
export async function deleteUnreferenced(
  referenced: Set<string>,
  opts: { protect?: Set<string>; now?: number } = {},
): Promise<{ media: number; derived: number; kept: number }> {
  const d = await db();
  const now = opts.now ?? Date.now();
  let media = 0;
  let derived = 0;
  let kept = 0;
  const removed = new Set<string>();
  for (const key of await d.getAllKeys('media')) {
    const id = String(key);
    if (referenced.has(id) || opts.protect?.has(id)) continue;
    const addedAt = (await d.get('meta', `mediaAddedAt:${id}`)) as number | undefined;
    // 넣은 시각 기록이 없는 옛 원본(이 기능 전에 넣은 것)도 이번에는 남기고, 지금부터 시간을 잰다
    if (addedAt === undefined) {
      await d.put('meta', now, `mediaAddedAt:${id}`);
      kept++;
      continue;
    }
    if (now - addedAt < MEDIA_GRACE_MS) {
      kept++;
      continue;
    }
    await d.delete('media', key);
    await d.delete('meta', `mediaAddedAt:${id}`);
    await d.delete('meta', `mediaRemovedAt:${id}`);
    removed.add(id);
    media++;
  }
  for (const key of await d.getAllKeys('derived')) {
    const owner = String(key).split(':')[0];
    // 파생 데이터는 원본이 지워졌거나 원본 자체가 없을 때만 지운다
    const hasSource = (await d.getKey('media', owner)) !== undefined;
    if (removed.has(owner) || (!hasSource && !referenced.has(owner) && !opts.protect?.has(owner))) {
      await d.delete('derived', key);
      derived++;
    }
  }
  return { media, derived, kept };
}

/** 남은 저장 공간 (브라우저가 알려 주지 않으면 null) */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
