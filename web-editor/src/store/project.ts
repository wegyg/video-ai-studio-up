/**
 * 프로젝트 스토어 (zustand + zundo).
 * 실행 취소 대상은 `edit`(비율, 트랙, 클립)뿐이다. 미디어 목록(assets), 플레이헤드, 선택은 기록하지 않는다.
 */
import { create } from 'zustand';
import { temporal } from 'zundo';
import { ko } from '../i18n/ko';
import * as ops from '../model/ops';
import type { AssetMeta, Clip, EditState, Ratio, TrackKind } from '../model/types';

export interface ProjectSnapshot {
  id: string;
  name: string;
  assets: Record<string, AssetMeta>;
  edit: EditState;
}

export interface ProjectState extends ProjectSnapshot {
  /** 이름 변경은 실행 취소 대상이 아니다 */
  setName: (name: string) => void;
  setRatio: (ratio: Ratio) => void;
  addAsset: (asset: AssetMeta) => void;
  updateAsset: (id: string, patch: Partial<AssetMeta>) => void;
  /** 성공하면 넣은 클립 id */
  addClip: (trackId: string, clip: Clip) => string | null;
  moveClip: (clipId: string, toTrackId: string, toStart: number) => void;
  trimClip: (clipId: string, edge: 'start' | 'end', frame: number) => void;
  /** 성공하면 오른쪽 클립 id */
  splitClip: (clipId: string, at: number) => string | null;
  deleteClip: (clipId: string) => void;
  updateClip: (clipId: string, fn: (c: Clip) => Clip) => void;
  addTrack: (kind: TrackKind) => void;
  setTrackMuted: (trackId: string, muted: boolean) => void;
  /** 저장된 프로젝트로 통째로 바꾼다 (실행 취소 기록은 비운다) */
  replaceProject: (p: ProjectSnapshot) => void;
}

type Tracked = { edit: EditState };

export function createEmptyProject(): ProjectSnapshot {
  return { id: ops.newId('proj'), name: ko.project.defaultName, assets: {}, edit: ops.createEditState('9:16', ko.tracks) };
}

export const useProject = create<ProjectState>()(
  temporal(
    (set, get) => {
      const apply = (fn: (e: EditState) => EditState): boolean => {
        const cur = get().edit;
        const next = fn(cur);
        if (next === cur) return false;
        set({ edit: next });
        return true;
      };
      return {
        ...createEmptyProject(),
        setName: (name) => set({ name }),
        setRatio: (ratio) => apply((e) => (e.ratio === ratio ? e : { ...e, ratio })),
        addAsset: (asset) => set((s) => ({ assets: { ...s.assets, [asset.id]: asset } })),
        updateAsset: (id, patch) =>
          set((s) => (s.assets[id] ? { assets: { ...s.assets, [id]: { ...s.assets[id], ...patch } } } : s)),
        addClip: (trackId, clip) => (apply((e) => ops.addClip(e, trackId, clip)) ? clip.id : null),
        moveClip: (clipId, toTrackId, toStart) => apply((e) => ops.moveClip(e, clipId, toTrackId, toStart)),
        trimClip: (clipId, edge, frame) => apply((e) => ops.trimClip(e, get().assets, clipId, edge, frame)),
        splitClip: (clipId, at) => {
          const r = ops.splitClip(get().edit, clipId, at);
          if (!r.rightId) return null;
          set({ edit: r.edit });
          return r.rightId;
        },
        deleteClip: (clipId) => apply((e) => ops.deleteClip(e, clipId)),
        updateClip: (clipId, fn) => apply((e) => ops.updateClip(e, clipId, fn)),
        addTrack: (kind) =>
          apply((e) => {
            const n = e.tracks.filter((t) => t.kind === kind).length + 1;
            const name = kind === 'video' ? ko.tracks.video(n) : kind === 'audio' ? ko.tracks.audio(n) : ko.tracks.text;
            return ops.addTrack(e, kind, name);
          }),
        setTrackMuted: (trackId, muted) => apply((e) => ops.setTrackMuted(e, trackId, muted)),
        replaceProject: (p) => {
          set({ id: p.id, name: p.name, assets: p.assets, edit: p.edit });
          useProject.temporal.getState().clear();
        },
      };
    },
    {
      partialize: (s): Tracked => ({ edit: s.edit }),
      // edit 객체가 그대로면(미디어 추가 등) 기록하지 않는다
      equality: (a, b) => a.edit === b.edit,
      limit: 200,
    },
  ),
);
