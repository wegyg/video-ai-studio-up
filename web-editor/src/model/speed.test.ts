import { describe, expect, it } from 'vitest';
import { timeStretch } from '../engine/export/time-stretch';
import * as ops from './ops';
import { sourceFrame, srcAt } from './transitions';
import type { AssetMeta, Clip, EditState, MediaClip } from './types';

const names = { text: 'T', video: (n: number) => `V${n}`, audio: (n: number) => `A${n}` };
const video: AssetMeta = { id: 'v', kind: 'video', name: 'v', size: 1, mime: 'x', lastModified: 0, durationFrames: 120, hasAudio: true, hasProxy: false };
const image: AssetMeta = { ...video, id: 'img', kind: 'image', durationFrames: undefined, hasAudio: false };
const assets = { v: video, img: image };

function edit(...clips: Clip[]): EditState {
  const e = ops.createEditState('9:16', names);
  return { ...e, tracks: e.tracks.map((t, i) => (i === 2 ? { ...t, clips } : t)) };
}
const main = (e: EditState) => e.tracks[2].clips as MediaClip[];
const v = (extra: Partial<MediaClip> = {}): MediaClip => ({ ...ops.createMediaClip(video, 0), id: 'a', ...extra });

describe('속도 (R17)', () => {
  it('2배: 길이 절반, 타임라인 1프레임 = 원본 2프레임, 같은 트랙 뒤 클립은 당겨진다', () => {
    const img = { ...ops.createMediaClip(image, 120), id: 'b' };
    const e = ops.setClipSpeed(edit(v(), img), assets, 'a', 2);
    const [a, b] = main(e);
    expect([a.speed, a.duration, b.start]).toEqual([2, 60, 60]);
    expect(srcAt(a, 20)).toBe(40);
    expect(sourceFrame(a, 59, 120)).toBe(118);
    // 0.5배: 원본 구간 120프레임 → 타임라인 240
    const slow = main(ops.setClipSpeed(e, assets, 'a', 0.5));
    expect([slow[0].duration, slow[1].start]).toEqual([240, 240]);
    expect(srcAt(slow[0], 100)).toBe(50);
  });

  it('범위는 0.25~4, 원본 끝을 넘지 않는다, 같으면 그대로', () => {
    const e = edit(v({ duration: 60 }));
    expect(main(ops.setClipSpeed(e, assets, 'a', 10))[0].speed).toBe(4);
    expect(main(ops.setClipSpeed(e, assets, 'a', 0.1))[0].speed).toBe(0.25);
    expect(ops.setClipSpeed(e, assets, 'a', 1)).toBe(e);
    // 원본 120프레임 중 60프레임만 쓰는 클립을 0.25배로: 원본 구간 60 → 240프레임 (원본 안)
    expect(main(ops.setClipSpeed(e, assets, 'a', 0.25))[0].duration).toBe(240);
  });

  it('자르기·나누기는 원본 위치를 속도만큼 옮긴다, 키프레임은 같은 장면에 남는다', () => {
    const e = ops.setClipSpeed(edit(v({ keyframes: { x: [{ f: 60, v: 100, ease: 'linear' }] } })), assets, 'a', 2);
    expect(main(e)[0].keyframes?.x?.[0].f).toBe(30);
    const trimmed = main(ops.trimClip(e, assets, 'a', 'start', 10))[0];
    expect([trimmed.start, trimmed.inPoint, trimmed.duration]).toEqual([10, 20, 50]);
    const cut = main(ops.splitClip(e, 'a', 25).edit);
    expect(cut[1].inPoint).toBe(50);
    expect(srcAt(cut[1], 30)).toBe(srcAt(main(e)[0], 30));
    // 뒤 끝은 원본 끝까지만 늘릴 수 있다: 원본 120 / 2 = 60프레임
    expect(main(ops.trimClip(e, assets, 'a', 'end', 200))[0].duration).toBe(60);
  });
});

describe('음 높이 유지 (WSOLA)', () => {
  const rate = 48000;
  const tone = (hz: number, sec: number) => Float32Array.from({ length: rate * sec }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));
  /** 가운데 구간의 영점 교차로 주파수 추정 */
  const freq = (x: Float32Array) => {
    const a = Math.floor(x.length * 0.25);
    const b = Math.floor(x.length * 0.75);
    let n = 0;
    for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 !== x[i] < 0) n++;
    return n / 2 / ((b - a) / rate);
  };
  it('2배·0.5배로 바꿔도 660Hz 그대로, 길이는 1/속도', () => {
    for (const speed of [2, 0.5, 1.5]) {
      const [out] = timeStretch([tone(660, 1)], speed, rate);
      expect(out.length).toBe(Math.round(rate / speed));
      expect(Math.abs(freq(out) - 660) / 660, `${speed}배`).toBeLessThan(0.02);
    }
  });
});
