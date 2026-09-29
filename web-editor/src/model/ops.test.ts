import { describe, expect, it } from 'vitest';
import * as ops from './ops';
import type { AssetMeta, Clip, EditState, MediaClip } from './types';

const names = { text: 'T', video: (n: number) => `V${n}`, audio: (n: number) => `A${n}` };

function asset(id: string, kind: AssetMeta['kind'], durationFrames?: number): AssetMeta {
  return { id, kind, name: id, size: 1, mime: 'x', lastModified: 0, durationFrames, hasAudio: kind !== 'image', hasProxy: false };
}

const assets: Record<string, AssetMeta> = {
  v: asset('v', 'video', 120), // 4초
  img: asset('img', 'image'),
  a: asset('a', 'audio', 150),
};

function clip(assetId: string, start: number, duration: number, extra: Partial<MediaClip> = {}): MediaClip {
  return { ...ops.createMediaClip(assets[assetId], start), duration, ...extra };
}

/** 메인 영상 트랙(V1)에 클립들을 넣은 상태 */
function withMain(...clips: Clip[]): { edit: EditState; mainId: string } {
  let edit = ops.createEditState('9:16', names);
  const mainId = edit.tracks[2].id;
  for (const c of clips) edit = ops.addClip(edit, mainId, c);
  return { edit, mainId };
}

const mainClips = (e: EditState) => e.tracks[2].clips;

describe('createEditState', () => {
  it('기본 트랙: 텍스트, 영상2, 영상1, 오디오1 (위→아래)', () => {
    const e = ops.createEditState('16:9', names);
    expect(e.ratio).toBe('16:9');
    expect(e.tracks.map((t) => [t.kind, t.name])).toEqual([
      ['text', 'T'],
      ['video', 'V2'],
      ['video', 'V1'],
      ['audio', 'A1'],
    ]);
  });
  it('defaultTrackFor: 영상→맨 아래 영상 트랙, 오디오→첫 오디오, 텍스트→첫 텍스트', () => {
    const e = ops.createEditState('9:16', names);
    expect(ops.defaultTrackFor(e, 'video')?.name).toBe('V1');
    expect(ops.defaultTrackFor(e, 'image')?.name).toBe('V1');
    expect(ops.defaultTrackFor(e, 'audio')?.name).toBe('A1');
    expect(ops.defaultTrackFor(e, 'text')?.name).toBe('T');
  });
});

describe('freeStart', () => {
  const cs = [clip('v', 0, 30), clip('v', 60, 30)]; // [0,30) [60,90)
  it('빈 구간에 들어가면 그대로', () => expect(ops.freeStart(cs, 20, 35)).toBe(35));
  it('구간이 좁으면 다음 빈 구간으로', () => expect(ops.freeStart(cs, 40, 35)).toBe(90));
  it('가장 가까운 빈 구간을 고른다', () => expect(ops.freeStart(cs, 20, 10)).toBe(30));
  it('음수 위치는 0부터', () => expect(ops.freeStart([], 20, -50)).toBe(0));
});

describe('addClip', () => {
  it('같은 위치에 두 번 넣으면 두 번째는 뒤에 붙는다', () => {
    const { edit } = withMain(clip('v', 0, 30), clip('v', 0, 30));
    expect(mainClips(edit).map((c) => [c.start, c.duration])).toEqual([
      [0, 30],
      [30, 30],
    ]);
  });
  it('종류가 다른 트랙에는 넣지 않는다 (같은 객체 반환)', () => {
    const e = ops.createEditState('9:16', names);
    expect(ops.addClip(e, e.tracks[0].id, clip('a', 0, 30))).toBe(e);
  });
});

describe('moveClip', () => {
  it('빈 곳으로 이동', () => {
    const a = clip('v', 0, 30);
    const { edit, mainId } = withMain(a);
    const next = ops.moveClip(edit, a.id, mainId, 45);
    expect(mainClips(next)[0].start).toBe(45);
  });
  it('겹치는 위치에 놓으면 가장 가까운 빈 구간으로 보정', () => {
    const a = clip('v', 0, 30);
    const b = clip('v', 60, 30);
    const { edit, mainId } = withMain(a, b);
    const next = ops.moveClip(edit, a.id, mainId, 70); // b와 겹침 → b 뒤(90)가 가장 가까움
    expect(mainClips(next).map((c) => [c.id, c.start])).toEqual([
      [b.id, 60],
      [a.id, 90],
    ]);
  });
  it('다른 영상 트랙으로 이동', () => {
    const a = clip('v', 0, 30);
    const { edit } = withMain(a);
    const v2 = edit.tracks[1].id;
    const next = ops.moveClip(edit, a.id, v2, 12);
    expect(next.tracks[1].clips.map((c) => c.start)).toEqual([12]);
    expect(mainClips(next)).toHaveLength(0);
  });
  it('종류가 다른 트랙으로는 옮기지 않는다', () => {
    const a = clip('v', 0, 30);
    const { edit } = withMain(a);
    expect(ops.moveClip(edit, a.id, edit.tracks[3].id, 0)).toBe(edit);
  });
  it('위치가 그대로면 같은 객체', () => {
    const a = clip('v', 10, 30);
    const { edit, mainId } = withMain(a);
    expect(ops.moveClip(edit, a.id, mainId, 10)).toBe(edit);
  });
});

describe('trimClip', () => {
  it('시작 트림: inPoint가 함께 움직인다', () => {
    const a = clip('v', 30, 90); // 원본 0~90
    const { edit } = withMain(a);
    const c = mainClips(ops.trimClip(edit, assets, a.id, 'start', 45))[0] as MediaClip;
    expect([c.start, c.duration, c.inPoint]).toEqual([45, 75, 15]);
  });
  it('영상은 원본 시작보다 앞으로 늘릴 수 없다', () => {
    const a = clip('v', 30, 60, { inPoint: 10 });
    const { edit } = withMain(a);
    const c = mainClips(ops.trimClip(edit, assets, a.id, 'start', 0))[0] as MediaClip;
    expect([c.start, c.duration, c.inPoint]).toEqual([20, 70, 0]);
  });
  it('영상은 원본 길이를 넘어 늘어나지 않는다', () => {
    const a = clip('v', 0, 60, { inPoint: 30 }); // 원본 120프레임 → 최대 90프레임
    const { edit } = withMain(a);
    const c = mainClips(ops.trimClip(edit, assets, a.id, 'end', 500))[0];
    expect(c.duration).toBe(90);
  });
  it('이미지는 길이 제한이 없다', () => {
    const a = clip('img', 0, 150);
    const { edit } = withMain(a);
    expect(mainClips(ops.trimClip(edit, assets, a.id, 'end', 3000))[0].duration).toBe(3000);
  });
  it('최소 1프레임', () => {
    const a = clip('v', 30, 60);
    const { edit } = withMain(a);
    expect(mainClips(ops.trimClip(edit, assets, a.id, 'end', 0))[0].duration).toBe(1);
    expect(mainClips(ops.trimClip(edit, assets, a.id, 'start', 999))[0].duration).toBe(1);
  });
  it('이웃 클립과 겹치지 않는다', () => {
    const a = clip('img', 0, 30);
    const b = clip('img', 50, 30);
    const { edit } = withMain(a, b);
    expect(mainClips(ops.trimClip(edit, assets, a.id, 'end', 70))[0].duration).toBe(50);
    expect(mainClips(ops.trimClip(edit, assets, b.id, 'start', 10))[1].start).toBe(30);
  });
  it('페이드가 길이를 넘지 않게 줄어든다', () => {
    const a = clip('v', 0, 60, { fadeIn: 30, fadeOut: 30 });
    const { edit } = withMain(a);
    const c = mainClips(ops.trimClip(edit, assets, a.id, 'end', 20))[0] as MediaClip;
    expect([c.fadeIn, c.fadeOut]).toEqual([20, 20]);
  });
});

describe('splitClip', () => {
  it('분할 후 각 클립은 원본의 해당 구간을 정확히 가리킨다 (프레임 단위)', () => {
    const a = clip('v', 10, 100, { inPoint: 5 });
    const { edit } = withMain(a);
    const r = ops.splitClip(edit, a.id, 40);
    expect(r.rightId).not.toBeNull();
    const [left, right] = mainClips(r.edit) as MediaClip[];
    expect([left.start, left.duration, left.inPoint]).toEqual([10, 30, 5]);
    expect([right.start, right.duration, right.inPoint]).toEqual([40, 70, 35]);
    // 어느 타임라인 프레임이든 원본 프레임 = inPoint + (f - start) 가 분할 전과 같다
    for (const f of [10, 39, 40, 41, 109]) {
      const before = a.inPoint + (f - a.start);
      const part = f < 40 ? left : right;
      expect(part.inPoint + (f - part.start)).toBe(before);
    }
  });
  it('페이드 인은 왼쪽, 페이드 아웃은 오른쪽에만 남는다', () => {
    const a = clip('v', 0, 90, { fadeIn: 15, fadeOut: 20 });
    const { edit } = withMain(a);
    const [l, r] = mainClips(ops.splitClip(edit, a.id, 45).edit) as MediaClip[];
    expect([l.fadeIn, l.fadeOut, r.fadeIn, r.fadeOut]).toEqual([15, 0, 0, 20]);
  });
  it('클립 가장자리나 밖에서는 분할하지 않는다', () => {
    const a = clip('v', 10, 30);
    const { edit } = withMain(a);
    for (const at of [10, 40, 0, 99]) expect(ops.splitClip(edit, a.id, at)).toEqual({ edit, rightId: null });
  });
  it('텍스트 클립도 분할된다', () => {
    let e = ops.createEditState('9:16', names);
    const t = ops.createTextClip(0, '안녕');
    e = ops.addClip(e, e.tracks[0].id, t);
    const [l, r] = ops.splitClip(e, t.id, 30).edit.tracks[0].clips;
    expect([l.duration, r.start, r.duration]).toEqual([30, 30, 60]);
    expect(r.type === 'text' && r.text).toBe('안녕');
  });
});

describe('deleteClip / updateClip / tracks', () => {
  it('삭제', () => {
    const a = clip('v', 0, 30);
    const { edit } = withMain(a);
    expect(mainClips(ops.deleteClip(edit, a.id))).toHaveLength(0);
  });
  it('updateClip은 시간 값을 바꾸지 않는다', () => {
    const a = clip('v', 10, 30);
    const { edit } = withMain(a);
    const next = ops.updateClip(edit, a.id, (c) => ({ ...c, start: 999, duration: 1, transform: { ...c.transform, x: 50 } }));
    const c = mainClips(next)[0];
    expect([c.start, c.duration, c.transform.x]).toEqual([10, 30, 50]);
    expect(ops.updateClip(edit, a.id, (c) => c)).toBe(edit);
  });
  it('영상 트랙은 가장 위 영상 트랙 위에, 오디오는 맨 아래에 추가', () => {
    let e = ops.createEditState('9:16', names);
    e = ops.addTrack(e, 'video', 'V3');
    e = ops.addTrack(e, 'audio', 'A2');
    expect(e.tracks.map((t) => t.name)).toEqual(['T', 'V3', 'V2', 'V1', 'A1', 'A2']);
  });
  it('트랙 음소거', () => {
    const e = ops.createEditState('9:16', names);
    const a1 = e.tracks[3].id;
    expect(ops.setTrackMuted(e, a1, true).tracks[3].muted).toBe(true);
    expect(ops.setTrackMuted(e, a1, false)).toBe(e);
  });
});
