import { describe, expect, it } from 'vitest';
import * as ops from './ops';
import { snapCandidates, snapRange, snapValue } from './snap';
import { editDuration, formatTimecode, secondsToFrames } from './time';

describe('snap', () => {
  it('기준점과 threshold 이내면 달라붙는다', () => {
    expect(snapValue(33, [0, 30, 90], 4)).toEqual({ value: 30, target: 30 });
  });
  it('threshold 밖이면 그대로', () => {
    expect(snapValue(40, [0, 30, 90], 4)).toEqual({ value: 40, target: null });
  });
  it('더 가까운 기준점을 고른다', () => {
    expect(snapValue(31, [28, 32], 5).value).toBe(32);
  });
  it('이동 스냅: 끝이 더 가까우면 끝을 붙인다', () => {
    // 시작 50(기준 45와 5 차이), 끝 88(기준 90과 2 차이) → 끝을 90에 맞춰 시작 52
    expect(snapRange(50, 38, [45, 90], 6)).toEqual({ value: 52, target: 90 });
  });
  it('기준점: 0, 플레이헤드, 다른 클립 가장자리 (자기 자신 제외)', () => {
    const names = { text: 'T', video: (n: number) => `V${n}`, audio: (n: number) => `A${n}` };
    let e = ops.createEditState('9:16', names);
    const t = ops.createTextClip(10, 'a'); // 10~100
    const u = ops.createTextClip(200, 'b'); // 200~290
    e = ops.addClip(e, e.tracks[0].id, t);
    e = ops.addClip(e, e.tracks[0].id, u);
    expect(snapCandidates(e, u.id, 42).sort((a, b) => a - b)).toEqual([0, 10, 42, 100]);
  });
});

describe('time', () => {
  it('mm:ss.ff 형식', () => {
    expect(formatTimecode(0)).toBe('00:00.00');
    expect(formatTimecode(29)).toBe('00:00.29');
    expect(formatTimecode(30)).toBe('00:01.00');
    expect(formatTimecode(95)).toBe('00:03.05');
    expect(formatTimecode(61 * 30)).toBe('01:01.00');
  });
  it('초 → 프레임', () => expect(secondsToFrames(2.5)).toBe(75));
  it('전체 길이 = 가장 늦게 끝나는 클립', () => {
    const names = { text: 'T', video: (n: number) => `V${n}`, audio: (n: number) => `A${n}` };
    let e = ops.createEditState('9:16', names);
    expect(editDuration(e)).toBe(0);
    e = ops.addClip(e, e.tracks[0].id, ops.createTextClip(100, 'x'));
    expect(editDuration(e)).toBe(190);
  });
});
