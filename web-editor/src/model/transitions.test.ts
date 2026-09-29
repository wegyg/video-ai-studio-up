import { describe, expect, it } from 'vitest';
import * as ops from './ops';
import {
  cutsOf,
  maxTransitionFrames,
  nearestCut,
  normalizeTransitions,
  sourceFrame,
  transitionsOf,
  TRANSITION_MAX,
  visibleRange,
  visualAt,
} from './transitions';
import type { AssetMeta, Clip, EditState, MediaClip, Track } from './types';

const names = { text: 'T', video: (n: number) => `V${n}`, audio: (n: number) => `A${n}` };
const asset = (id: string, kind: AssetMeta['kind'], durationFrames?: number): AssetMeta => ({
  id,
  kind,
  name: id,
  size: 1,
  mime: 'x',
  lastModified: 0,
  durationFrames,
  hasAudio: kind !== 'image',
  hasProxy: false,
});
const assets: Record<string, AssetMeta> = { v: asset('v', 'video', 300), img: asset('img', 'image'), a: asset('a', 'audio', 300) };

let n = 0;
function clip(assetId: string, start: number, duration: number, extra: Partial<MediaClip> = {}): MediaClip {
  return { ...ops.createMediaClip(assets[assetId], start), id: `c${++n}`, duration, ...extra };
}
function main(...clips: Clip[]): EditState {
  let edit = ops.createEditState('9:16', names);
  for (const c of clips) edit = ops.addClip(edit, edit.tracks[2].id, c);
  return edit;
}
const track = (e: EditState): Track => e.tracks[2];
const dissolve = (duration: number) => ({ transitionIn: { kind: 'dissolve' as const, duration } });

describe('경계와 구간', () => {
  it('맞닿은 영상·이미지 클립 사이에만 경계가 있다 (빈틈이 있으면 없다)', () => {
    const e = main(clip('v', 0, 60), clip('img', 60, 60), clip('v', 130, 30));
    expect(cutsOf(track(e)).map((c) => c.frame)).toEqual([60]);
  });

  it('경계를 가운데 두고 앞쪽 floor(d/2), 뒤쪽 나머지 프레임에 걸친다', () => {
    const e = main(clip('v', 0, 60), clip('v', 60, 60, dissolve(15)));
    const [w] = transitionsOf(track(e));
    expect([w.start, w.cut, w.end, w.duration]).toEqual([53, 60, 68, 15]);
    // 진행도: 구간 첫 프레임은 0에 가깝고, 마지막 프레임은 1에 가깝다 (프레임 가운데 기준)
    expect(visualAt(track(e), 53)!.progress).toBeCloseTo(0.5 / 15);
    expect(visualAt(track(e), 67)!.progress).toBeCloseTo(14.5 / 15);
    // 효과를 못 쓸 때 보여 줄 클립: 경계 전에는 앞 클립, 경계부터 뒤 클립
    expect(visualAt(track(e), 59)!.clip.id).toBe(w.from.id);
    expect(visualAt(track(e), 60)!.clip.id).toBe(w.to.id);
    expect(visualAt(track(e), 52)!.transition).toBeNull();
    expect(visualAt(track(e), 68)!.transition).toBeNull();
  });

  it('길이는 양쪽 클립 안에 들어가게 줄어든다 (짧은 클립)', () => {
    const e = main(clip('v', 0, 4), clip('v', 4, 60, dissolve(30)));
    // 앞 클립이 4프레임이면 앞쪽 최대 4 → 길이 9 (4 + 5)
    expect(transitionsOf(track(e))[0].duration).toBe(9);
    expect(maxTransitionFrames(track(e), track(e).clips[1].id)).toBe(9);
    const e2 = main(clip('v', 0, 60), clip('v', 60, 3, dissolve(30)));
    expect(transitionsOf(track(e2))[0].duration).toBe(6); // 뒤쪽 최대 3 → 3 + 3
  });

  it('한 클립 양쪽의 트랜지션은 서로 겹치지 않는다', () => {
    const e = main(clip('v', 0, 60), clip('v', 60, 20, dissolve(30)), clip('v', 80, 60, dissolve(30)));
    const [w1, w2] = transitionsOf(track(e));
    expect(w1.end).toBeLessThanOrEqual(w2.start);
    // 가운데 클립(20프레임): 앞 트랜지션(30)이 뒤쪽 15프레임을 쓰면 다음 트랜지션 앞쪽은 5프레임까지 → 5 + 6 = 11
    expect(w1.duration).toBe(30);
    expect(w2.duration).toBe(11);
    expect(w1.end).toBe(75);
    expect(w2.start).toBe(75);
    // 편집 화면 상한: 이웃이 쓰는 부분(다음 트랜지션 앞쪽 5)을 빼고 계산 → 뒤쪽 최대 15 → 30
    expect(maxTransitionFrames(track(e), track(e).clips[1].id)).toBe(30);
    expect(maxTransitionFrames(track(e), track(e).clips[2].id)).toBe(11);
  });

  it('최대 2초, 가장 가까운 경계 찾기', () => {
    const e = main(clip('v', 0, 200), clip('v', 200, 200, dissolve(500)));
    expect(transitionsOf(track(e))[0].duration).toBe(TRANSITION_MAX);
    expect(nearestCut(track(e), 190, 15)?.frame).toBe(200);
    expect(nearestCut(track(e), 150, 15)).toBeNull();
  });

  it('보이는 범위가 트랜지션만큼 늘어난다', () => {
    const e = main(clip('v', 0, 60), clip('v', 60, 60, dissolve(15)));
    const [a, b] = track(e).clips;
    expect(visibleRange(track(e), a)).toEqual({ start: 0, end: 68 });
    expect(visibleRange(track(e), b)).toEqual({ start: 53, end: 120 });
  });
});

describe('원본 프레임 (자르고 남은 여분 사용)', () => {
  it('여분이 있으면 범위 밖 프레임을 원본에서 가져오고, 없으면 끝 프레임에 멈춘다', () => {
    const c = clip('v', 100, 50, { inPoint: 20 });
    expect(sourceFrame(c, 100, 300)).toBe(20);
    expect(sourceFrame(c, 155, 300)).toBe(75); // 뒤쪽 여분
    expect(sourceFrame(c, 90, 300)).toBe(10); // 앞쪽 여분
    expect(sourceFrame(c, 70, 300)).toBe(0); // 원본 시작보다 앞 → 첫 프레임
    expect(sourceFrame(c, 500, 300)).toBe(299); // 원본 끝 → 마지막 프레임
    expect(sourceFrame(c, 155)).toBe(69); // 원본 길이를 모르면 클립 범위 안
    expect(sourceFrame(clip('img', 0, 10), 5, 300)).toBe(0);
  });
});

describe('정리 (normalizeTransitions)', () => {
  it('바뀐 게 없으면 같은 객체', () => {
    const e = main(clip('v', 0, 60), clip('v', 60, 60, dissolve(15)));
    expect(normalizeTransitions(e)).toBe(e);
  });

  it('떨어진 클립의 트랜지션은 지우고, 너무 긴 것은 줄인다', () => {
    const e = main(clip('v', 0, 60), clip('v', 60, 60, dissolve(15)));
    const moved = ops.moveClip(e, track(e).clips[1].id, track(e).id, 90);
    const fixed = normalizeTransitions(moved);
    expect((track(fixed).clips[1] as MediaClip).transitionIn).toBeUndefined();

    const long = main(clip('v', 0, 4), clip('v', 4, 60, dissolve(30)));
    expect((track(normalizeTransitions(long)).clips[1] as MediaClip).transitionIn?.duration).toBe(9);
  });

  it('자르면 들어오는 트랜지션은 왼쪽 조각에 남고, 새 자른 자리에는 없다', () => {
    const e = main(clip('v', 0, 60), clip('v', 60, 60, dissolve(15)));
    const { edit } = ops.splitClip(e, track(e).clips[1].id, 90);
    const [, left, right] = track(edit).clips as MediaClip[];
    expect(left.transitionIn?.kind).toBe('dissolve');
    expect(right.transitionIn).toBeUndefined();
  });

  it('앞 클립을 지우면 트랜지션도 없어진다', () => {
    const e = main(clip('v', 0, 60), clip('v', 60, 60, dissolve(15)));
    const del = normalizeTransitions(ops.deleteClip(e, track(e).clips[0].id));
    expect((track(del).clips[0] as MediaClip).transitionIn).toBeUndefined();
  });
});
