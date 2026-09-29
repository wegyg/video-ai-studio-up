import { beforeEach, describe, expect, it } from 'vitest';
import * as ops from '../model/ops';
import type { AssetMeta } from '../model/types';
import { history } from './history';
import { createEmptyProject, useProject } from './project';

const past = () => useProject.temporal.getState().pastStates.length;
const future = () => useProject.temporal.getState().futureStates.length;
const main = () => useProject.getState().edit.tracks[2];

const video: AssetMeta = {
  id: 'v1', kind: 'video', name: 'a.mp4', size: 10, mime: 'video/mp4', lastModified: 0,
  durationFrames: 120, width: 540, height: 960, hasAudio: true, hasProxy: false,
};

beforeEach(() => useProject.getState().replaceProject(createEmptyProject()));

describe('프로젝트 스토어 + 실행 취소', () => {
  it('처음에는 기록이 없다', () => {
    expect(past()).toBe(0);
    expect(useProject.getState().edit.tracks).toHaveLength(4);
  });

  it('미디어 추가는 실행 취소 기록에 남지 않는다', () => {
    useProject.getState().addAsset(video);
    expect(useProject.getState().assets.v1.name).toBe('a.mp4');
    expect(past()).toBe(0);
  });

  it('클립 추가 → 실행 취소 → 다시 실행', () => {
    const s = useProject.getState();
    s.addAsset(video);
    const id = s.addClip(main().id, ops.createMediaClip(video, 0));
    expect(id).not.toBeNull();
    expect(past()).toBe(1);
    history.undo();
    expect(main().clips).toHaveLength(0);
    expect(future()).toBe(1);
    history.redo();
    expect(main().clips.map((c) => c.id)).toEqual([id]);
  });

  it('드래그 한 번(갱신 여러 번)은 기록 1개 (R9.3)', () => {
    const s = useProject.getState();
    s.addAsset(video);
    const id = s.addClip(main().id, ops.createMediaClip(video, 0))!;
    const before = past();
    history.beginGesture();
    for (let x = 1; x <= 20; x++) useProject.getState().moveClip(id, main().id, x * 3);
    history.endGesture();
    expect(main().clips[0].start).toBe(60);
    expect(past()).toBe(before + 1);
    history.undo();
    expect(main().clips[0].start).toBe(0);
  });

  it('아무것도 바뀌지 않은 제스처는 기록하지 않는다', () => {
    const before = past();
    history.beginGesture();
    history.endGesture();
    expect(past()).toBe(before);
  });

  it('제스처 취소는 시작 상태로 되돌리고 기록하지 않는다', () => {
    const s = useProject.getState();
    s.addAsset(video);
    const id = s.addClip(main().id, ops.createMediaClip(video, 0))!;
    const before = past();
    history.beginGesture();
    useProject.getState().moveClip(id, main().id, 90);
    history.cancelGesture();
    expect(main().clips[0].start).toBe(0);
    expect(past()).toBe(before);
    // 취소 뒤에도 기록은 계속된다
    useProject.getState().setRatio('1:1');
    expect(past()).toBe(before + 1);
  });

  it('분할/삭제/트림도 각각 기록 1개', () => {
    const s = useProject.getState();
    s.addAsset(video);
    const id = s.addClip(main().id, ops.createMediaClip(video, 0))!;
    const n = past();
    const right = useProject.getState().splitClip(id, 45);
    expect(right).not.toBeNull();
    useProject.getState().trimClip(id, 'end', 30);
    useProject.getState().deleteClip(right!);
    expect(past()).toBe(n + 3);
    history.undo(3);
    expect(main().clips).toHaveLength(1);
    expect(main().clips[0].duration).toBe(120);
  });

  it('프로젝트 교체는 기록을 비운다', () => {
    useProject.getState().setRatio('16:9');
    expect(past()).toBe(1);
    useProject.getState().replaceProject(createEmptyProject());
    expect(past()).toBe(0);
    expect(useProject.getState().edit.ratio).toBe('9:16');
  });
});
