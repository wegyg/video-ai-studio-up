/** 테스트용 창구: window.__editor. 편집기 내부 상태를 읽기 전용 데이터로 노출한다. */
import type { EditorDebugApi } from './debug-types';
import { previewRef } from './engine/preview/PreviewEngine';
import { lastExportBuffer } from './engine/export';
import { saveNow, savedTimes } from './storage/persist';
import { toProjectFile } from './storage/project-json';
import { useMedia } from './media/store';
import { db, listMediaSizes } from './storage/db';
import { useProject } from './store/project';
import { useUI } from './store/ui';
import { detectSupport } from './support';

export const debugApi: EditorDebugApi = {
  version: '0.1.0',
  support: async () => ({ ...(await detectSupport()) }),
  // 스파이크 코드는 테스트에서만 필요하므로 별도 청크로 나눠 필요할 때만 불러온다.
  spike: async (video: Blob) => (await import('./dev/spike')).runSpike(video),
  state: () => {
    const p = useProject.getState();
    const u = useUI.getState();
    const t = useProject.temporal.getState();
    return JSON.parse(
      JSON.stringify({
        id: p.id,
        name: p.name,
        assets: p.assets,
        edit: p.edit,
        ui: { selectedClipId: u.selectedClipId, playhead: u.playhead, playing: u.playing, pxPerFrame: u.pxPerFrame, snap: u.snap, leftTab: u.leftTab },
        history: { past: t.pastStates.length, future: t.futureStates.length },
      }),
    );
  },
  media: (id) => {
    const e = useMedia.getState().entries[id];
    if (!e) return null;
    const f = e.filmstrip;
    return {
      status: e.status,
      progress: e.progress,
      hasUrl: !!e.url,
      hasPoster: !!e.posterUrl,
      filmstrip: f ? { count: f.count, interval: f.interval, thumbW: f.thumbW, thumbH: f.thumbH, cols: f.cols } : null,
      peaksLength: e.peaks?.length ?? 0,
      peaksMax: e.peaks ? e.peaks.reduce((m, v) => Math.max(m, v), 0) : 0,
    };
  },
  filmstripPixel: (id, index) => {
    const f = useMedia.getState().entries[id]?.filmstrip;
    if (!f || index >= f.count) return null;
    const c = new OffscreenCanvas(1, 1);
    const ctx = c.getContext('2d')!;
    const sx = (index % f.cols) * f.thumbW + f.thumbW / 2;
    const sy = Math.floor(index / f.cols) * f.thumbH + f.thumbH / 2;
    ctx.drawImage(f.bitmap, sx, sy, 1, 1, 0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  },
  stored: async () => ({
    media: await listMediaSizes(),
    derivedKeys: (await (await db()).getAllKeys('derived')).map(String),
  }),
  preview: () => previewRef.current?.stats() ?? null,
  clipGain: (clipId) => previewRef.current?.clipGain(clipId) ?? null,
  saveNow: () => saveNow(),
  savedTimes: () => savedTimes(),
  projectFile: () => toProjectFile(),
  removeAsset: (id: string) => useProject.getState().removeAsset(id),
  clipBox: (clipId) => {
    const id = clipId ?? useUI.getState().selectedClipId;
    return id ? (previewRef.current?.boxOf(id) ?? null) : null;
  },
  previewPixel: (fx = 0.5, fy = 0.5) => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const d = c.getContext('2d')!.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
    return [d[0], d[1], d[2]];
  },
  previewPixels: (points) => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const ctx = c.getContext('2d')!;
    return points.map(([fx, fy]) => {
      const x = Math.min(c.width - 1, Math.max(0, Math.floor(c.width * fx)));
      const y = Math.min(c.height - 1, Math.max(0, Math.floor(c.height * fy)));
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
  },
  verifyLastExport: async (times, points) => {
    const buffer = lastExportBuffer();
    if (!buffer) throw new Error('내보낸 파일이 없습니다');
    return (await import('./dev/verify-export')).exportedPixels(buffer, times, points);
  },
  lastExportBytes: () => lastExportBuffer()?.byteLength ?? 0,
};

export function installDebugApi(): void {
  window.__editor = debugApi;
}
