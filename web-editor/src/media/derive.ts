/**
 * 파생 데이터(포스터/필름스트립/파형) 관리: Worker에 요청하고, 결과를 useMedia에 반영하고, IndexedDB에 저장한다.
 * 저장된 것이 있으면 다시 만들지 않는다.
 */
import type { AssetMeta } from '../model/types';
import { getDerived, getMedia, putDerived, type FilmstripRecord } from '../storage/db';
import type { DeriveMessage, DeriveRequest } from './derive-protocol';
import { sourceBlobs, useMedia } from './store';

let worker: Worker | null = null;
/** id별로 메시지를 순서대로 처리한다 (비동기 처리 중에 'done'이 먼저 반영되지 않도록) */
const chains = new Map<string, Promise<void>>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./derive.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<DeriveMessage>) => {
      const m = e.data;
      const prev = chains.get(m.id) ?? Promise.resolve();
      chains.set(m.id, prev.then(() => handle(m)).catch(() => undefined));
    };
  }
  return worker;
}

async function handle(m: DeriveMessage): Promise<void> {
  const patch = useMedia.getState().patch;
  switch (m.type) {
    case 'progress':
      patch(m.id, { progress: m.progress });
      break;
    case 'poster':
      patch(m.id, { posterUrl: URL.createObjectURL(m.blob) });
      await putDerived(`${m.id}:poster`, m.blob);
      break;
    case 'filmstrip': {
      const { blob, count, interval, thumbW, thumbH, cols } = m;
      patch(m.id, { filmstrip: { bitmap: await createImageBitmap(blob), count, interval, thumbW, thumbH, cols } });
      await putDerived(`${m.id}:filmstrip`, { blob, count, interval, thumbW, thumbH, cols } satisfies FilmstripRecord);
      break;
    }
    case 'peaks':
      patch(m.id, { peaks: m.peaks });
      await putDerived(`${m.id}:peaks`, m.peaks);
      break;
    case 'done':
      patch(m.id, { status: 'ready', progress: 1 });
      break;
    case 'error':
      // 파생 데이터가 없어도 편집에는 쓸 수 있다
      patch(m.id, { status: 'ready', progress: 1 });
      console.warn(`[derive] ${m.id}: ${m.message}`);
      break;
  }
}

function sourceUrl(blob: Blob, kind: AssetMeta['kind']): string {
  // .mov(video/quicktime)도 <video>가 재생하도록 형식만 mp4로 바꾼 Blob을 쓴다 (데이터 복사 없음)
  return URL.createObjectURL(kind === 'video' ? blob.slice(0, blob.size, 'video/mp4') : blob);
}

/** 가져온 파일을 등록하고 파생 데이터 생성을 요청한다 */
export function registerNewAsset(asset: AssetMeta, blob: Blob): void {
  sourceBlobs.set(asset.id, blob);
  useMedia.getState().patch(asset.id, { status: 'loading', progress: 0, url: sourceUrl(blob, asset.kind) });
  const req: DeriveRequest = {
    id: asset.id,
    kind: asset.kind,
    blob,
    poster: asset.kind !== 'audio',
    filmstrip: asset.kind === 'video',
    peaks: asset.hasAudio,
  };
  getWorker().postMessage(req);
}

/**
 * 저장된 미디어를 다시 불러온다 (새로고침 후, 태스크 9에서 사용).
 * 원본은 IndexedDB에서, 파생 데이터도 저장된 것이 있으면 그대로 쓰고 없는 것만 다시 만든다.
 */
export async function loadStoredAsset(asset: AssetMeta): Promise<boolean> {
  const blob = await getMedia(asset.id);
  const patch = useMedia.getState().patch;
  if (!blob) {
    patch(asset.id, { status: 'error', progress: 0 });
    return false;
  }
  sourceBlobs.set(asset.id, blob);
  patch(asset.id, { status: 'loading', progress: 0, url: sourceUrl(blob, asset.kind) });
  const [poster, film, peaks] = await Promise.all([
    getDerived<Blob>(`${asset.id}:poster`),
    getDerived<FilmstripRecord>(`${asset.id}:filmstrip`),
    getDerived<Float32Array>(`${asset.id}:peaks`),
  ]);
  if (poster) patch(asset.id, { posterUrl: URL.createObjectURL(poster) });
  if (film) patch(asset.id, { filmstrip: { ...film, bitmap: await createImageBitmap(film.blob) } });
  if (peaks) patch(asset.id, { peaks });
  const req: DeriveRequest = {
    id: asset.id,
    kind: asset.kind,
    blob,
    poster: asset.kind !== 'audio' && !poster,
    filmstrip: asset.kind === 'video' && !film,
    peaks: asset.hasAudio && !peaks,
  };
  if (req.poster || req.filmstrip || req.peaks) getWorker().postMessage(req);
  else patch(asset.id, { status: 'ready', progress: 1 });
  return true;
}
