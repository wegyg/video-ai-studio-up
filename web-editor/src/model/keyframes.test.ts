import { describe, expect, it } from 'vitest';
import { gainAt } from './audio';
import { clipAtFrame, keyOffsets, maxScale, moveKeys, propsKeyedAt, sample, setEaseAt, setValues, toggleKeys, transformAt, valueAt } from './keyframes';
import * as ops from './ops';
import type { AssetMeta, Clip, Keyframe, MediaClip } from './types';

const asset: AssetMeta = { id: 'img', kind: 'image', name: 'img', size: 1, mime: 'x', lastModified: 0, hasAudio: false, hasProxy: false };
const video: AssetMeta = { ...asset, id: 'v', kind: 'video', durationFrames: 300, hasAudio: true };
const clip = (extra: Partial<MediaClip> = {}): MediaClip => ({ ...ops.createMediaClip(asset, 100), id: 'c', duration: 90, ...extra });
const k = (f: number, v: number, ease: Keyframe['ease'] = 'linear'): Keyframe => ({ f, v, ease });

describe('보간', () => {
  it('선형: 두 키 사이는 직선, 첫 키 앞·마지막 키 뒤는 그 값 그대로', () => {
    const keys = [k(0, -300), k(60, 300)];
    expect(sample(keys, -10)).toBe(-300);
    expect(sample(keys, 30)).toBe(0);
    expect(sample(keys, 15)).toBe(-150);
    expect(sample(keys, 90)).toBe(300);
  });

  it('부드럽게: 천천히 시작해 천천히 멈춘다 (가운데는 같고, 1/4 지점은 선형보다 덜 갔다)', () => {
    const keys = [k(0, 0, 'smooth'), k(40, 100)];
    expect(sample(keys, 20)).toBeCloseTo(50);
    expect(sample(keys, 10)).toBeCloseTo(15.625); // 0.25² × (3 − 0.5) = 0.15625
    expect(sample(keys, 30)).toBeCloseTo(84.375);
  });

  it('구간마다 앞 키의 이징을 쓴다', () => {
    const keys = [k(0, 0, 'smooth'), k(10, 10), k(20, 20)];
    expect(sample(keys, 5)).toBeCloseTo(5);
    expect(sample(keys, 2.5)).toBeCloseTo(1.5625);
    expect(sample(keys, 12.5)).toBeCloseTo(12.5); // 두 번째 구간은 선형
  });

  it('타임라인 프레임 → 클립 기준 시각, 키가 없으면 클립 값', () => {
    const c = clip({ keyframes: { x: [k(0, 0), k(60, 600)] } });
    expect(valueAt(c, 'x', 130)).toBe(300);
    expect(valueAt(c, 'scale', 130)).toBe(1);
    expect(transformAt(c, 130)).toEqual({ x: 300, y: 0, scale: 1, rotation: 0, opacity: 1 });
    const plain = clip();
    expect(transformAt(plain, 130)).toBe(plain.transform);
    expect(clipAtFrame(plain, 130)).toBe(plain);
  });
});

describe('편집', () => {
  it('키가 없는 속성은 클립 값을, 키가 있는 속성은 플레이헤드의 키를 고친다', () => {
    let c: Clip = clip();
    c = setValues(c, 110, { x: 50 });
    expect(c.transform.x).toBe(50);
    expect(c.keyframes).toBeUndefined();
    c = toggleKeys(c, 110, ['x', 'y']); // 10프레임에 위치 키 (지금 값 50, 0)
    expect(c.keyframes).toEqual({ x: [k(10, 50)], y: [k(10, 0)] });
    c = setValues(c, 160, { x: 250 }); // 다른 시각에서 바꾸면 새 키
    expect(c.keyframes!.x).toEqual([k(10, 50), k(60, 250)]);
    c = setValues(c, 160, { x: 200 }); // 같은 시각이면 그 키를 고친다
    expect(c.keyframes!.x).toEqual([k(10, 50), k(60, 200)]);
    expect(valueAt(c, 'x', 135)).toBe(125);
    expect(setValues(c, 160, { x: 200 })).toBe(c); // 바뀐 게 없으면 같은 객체
  });

  it('◆로 다 있는 키를 빼면 지워지고, 마지막 키를 빼면 그 순간의 값이 클립 값으로 남는다', () => {
    let c: Clip = clip({ keyframes: { scale: [k(0, 1), k(60, 2)] } });
    expect(propsKeyedAt(c, 60)).toEqual(['scale']);
    c = toggleKeys(c, 160, ['scale']);
    expect(c.keyframes!.scale).toEqual([k(0, 1)]);
    c = toggleKeys(c, 100, ['scale']);
    expect(c.keyframes).toBeUndefined();
    expect(c.transform.scale).toBe(1);
  });

  it('이징 바꾸기, 키 옮기기(놓은 곳의 같은 속성 키는 대신한다), 가장 큰 크기', () => {
    let c: Clip = clip({ keyframes: { scale: [k(0, 1), k(30, 3), k(60, 2)], opacity: [k(30, 0.5)] } });
    c = setEaseAt(c, 30, 'smooth');
    expect(c.keyframes!.scale![1].ease).toBe('smooth');
    expect(c.keyframes!.opacity![0].ease).toBe('smooth');
    c = moveKeys(c, 30, 60);
    expect(c.keyframes!.scale).toEqual([k(0, 1), k(60, 3, 'smooth')]);
    expect(c.keyframes!.opacity).toEqual([k(60, 0.5, 'smooth')]);
    expect(keyOffsets(c)).toEqual([0, 60]);
    expect(maxScale(c)).toBe(3);
  });
});

describe('자르기·나누기·소리', () => {
  const names = { text: 'T', video: (n: number) => `V${n}`, audio: (n: number) => `A${n}` };

  it('앞을 자르거나 나눠도 키는 타임라인의 같은 순간에 남고, 값이 끊기지 않는다', () => {
    const c = { ...ops.createMediaClip(video, 0), id: 'v1', duration: 120, keyframes: { x: [k(0, 0), k(100, 1000)] } };
    let e = ops.addClip(ops.createEditState('9:16', names), ops.createEditState('9:16', names).tracks[2].id, c);
    e = { ...e, tracks: e.tracks.map((t, i) => (i === 2 ? { ...t, clips: [c] } : t)) };
    const trimmed = ops.trimClip(e, { v: video }, 'v1', 'start', 20).tracks[2].clips[0];
    expect(trimmed.start).toBe(20);
    expect(trimmed.keyframes!.x).toEqual([k(-20, 0), k(80, 1000)]);
    expect(valueAt(trimmed, 'x', 50)).toBe(500);

    const { edit, rightId } = ops.splitClip(e, 'v1', 40);
    const [left, right] = edit.tracks[2].clips;
    expect(right.id).toBe(rightId);
    expect(valueAt(left, 'x', 39)).toBe(390);
    expect(valueAt(right, 'x', 40)).toBe(400);
    expect(valueAt(right, 'x', 90)).toBe(900);
  });

  it('볼륨 키가 있으면 소리 크기 곡선이 그 키를 따른다 (페이드와 곱해진다)', () => {
    const a = { ...clip(), start: 0, duration: 90, volume: 1, fadeIn: 0, fadeOut: 30, keyframes: { volume: [k(0, 0), k(30, 2)] } };
    expect(gainAt(a, 15)).toBeCloseTo(1);
    expect(gainAt(a, 30)).toBeCloseTo(2);
    expect(gainAt(a, 75)).toBeCloseTo(1); // 2 × 페이드 아웃 절반
  });
});
