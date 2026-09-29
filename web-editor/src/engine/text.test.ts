import { describe, expect, it } from 'vitest';
import { animState, fontString, revealLines, safeArea, wrapLines } from './text';
import { createTextClip } from '../model/ops';
import type { TextAnimType, TextClip } from '../model/types';

/** 한 글자 = 10px, 띄어쓰기 = 5px 로 가정한 측정기 */
const measure = (s: string) => [...s].reduce((w, c) => w + (c === ' ' ? 5 : 10), 0);

describe('wrapLines (자동 줄바꿈 R7.8)', () => {
  it('한 줄에 들어가면 그대로', () => {
    expect(wrapLines('안녕하세요', 200, measure)).toEqual(['안녕하세요']);
  });
  it('띄어쓰기 단위로 끊는다 (글자 중간에서 자르지 않음)', () => {
    // "가나다 라마바 사아자" → 각 낱말 30px, 공백 5px. 최대 70px이면 두 낱말(65px)까지
    expect(wrapLines('가나다 라마바 사아자', 70, measure)).toEqual(['가나다 라마바', '사아자']);
  });
  it('낱말 하나가 한 줄보다 길면 글자 단위로 나눈다', () => {
    expect(wrapLines('가나다라마바사', 30, measure)).toEqual(['가나다', '라마바', '사']);
  });
  it('사용자가 넣은 줄바꿈은 지킨다', () => {
    expect(wrapLines('첫째 줄\n둘째 줄', 999, measure)).toEqual(['첫째 줄', '둘째 줄']);
    expect(wrapLines('위\n\n아래', 999, measure)).toEqual(['위', '', '아래']);
  });
  it('긴 문장은 여러 줄이 되고, 글자는 하나도 사라지지 않는다', () => {
    const long = '홍보 영상을 만들 때 가장 중요한 것은 첫 세 초입니다';
    const lines = wrapLines(long, 120, measure);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(120);
    expect(lines.join(' ')).toBe(long);
  });
});

describe('safeArea / fontString', () => {
  it('안전 영역은 위 8%, 아래 18%, 좌우 5%', () => {
    expect(safeArea(1000, 2000)).toEqual({ x: 50, y: 160, w: 900, h: 1480 });
  });
  it('글꼴 문자열에 이름을 따옴표로 감싼다', () => {
    expect(fontString({ font: 'Noto Sans KR', size: 80, weight: 900 })).toBe('900 80px "Noto Sans KR", sans-serif');
  });
});

/** start=100, duration=90(3초), 등장/퇴장 15프레임 */
function clip(inType: TextAnimType, outType: TextAnimType = 'none'): TextClip {
  const c = createTextClip(100, '안녕하세요');
  return { ...c, duration: 90, animIn: { type: inType, duration: 15 }, animOut: { type: outType, duration: 15 } };
}

describe('animState (등장·퇴장 애니메이션 R7.7)', () => {
  it('none은 처음부터 제자리', () => {
    const c = clip('none');
    expect(animState(c, 100)).toEqual({ alpha: 1, scale: 1, dx: 0, dy: 0, reveal: 1 });
  });

  it('페이드: 시작 0 → 중간 0.5 → 끝 1', () => {
    const c = clip('fade');
    expect(animState(c, 100).alpha).toBe(0);
    expect(animState(c, 107.5).alpha).toBeCloseTo(0.5, 1);
    expect(animState(c, 115).alpha).toBe(1);
    expect(animState(c, 150).alpha).toBe(1);
  });

  it('퇴장 페이드: 끝에서 0', () => {
    const c = clip('none', 'fade');
    expect(animState(c, 150).alpha).toBe(1);
    expect(animState(c, 190).alpha).toBe(0);
    expect(animState(c, 182.5).alpha).toBeCloseTo(0.5, 1);
  });

  it('등장과 퇴장이 모두 있으면 양끝이 0, 가운데가 1', () => {
    const c = clip('fade', 'fade');
    expect(animState(c, 100).alpha).toBe(0);
    expect(animState(c, 145).alpha).toBe(1);
    expect(animState(c, 190).alpha).toBe(0);
  });

  it('팝·줌은 크기가 변하고 끝나면 1배', () => {
    for (const type of ['pop', 'zoom'] as TextAnimType[]) {
      const c = clip(type);
      expect(animState(c, 100).scale, type).not.toBeCloseTo(1, 2);
      expect(animState(c, 115).scale, type).toBeCloseTo(1, 2);
    }
  });

  it('슬라이드 4방향은 각각 다른 쪽에서 들어온다', () => {
    expect(animState(clip('slideUp'), 100).dy).toBeGreaterThan(0);
    expect(animState(clip('slideDown'), 100).dy).toBeLessThan(0);
    expect(animState(clip('slideLeft'), 100).dx).toBeGreaterThan(0);
    expect(animState(clip('slideRight'), 100).dx).toBeLessThan(0);
    for (const t of ['slideUp', 'slideDown', 'slideLeft', 'slideRight'] as TextAnimType[]) {
      const s = animState(clip(t), 115);
      expect(Math.hypot(s.dx, s.dy), t).toBeLessThan(1);
    }
  });

  it('바운스는 위에서 떨어져 제자리에 선다', () => {
    const c = clip('bounce');
    expect(animState(c, 100).dy).toBeLessThan(0);
    expect(animState(c, 115).dy).toBeCloseTo(0, 5);
  });

  it('타자기는 글자 비율이 늘어난다', () => {
    const c = clip('typewriter');
    expect(animState(c, 100).reveal).toBe(0);
    expect(animState(c, 107.5).reveal).toBeCloseTo(0.5, 1);
    expect(animState(c, 115).reveal).toBe(1);
  });

  it('길이가 0이면 애니메이션 없이 바로 제자리', () => {
    const c = { ...clip('fade'), animIn: { type: 'fade' as const, duration: 0 } };
    expect(animState(c, 100).alpha).toBe(1);
  });
});

describe('revealLines (타자기)', () => {
  const lines = ['가나다', '라마바'];
  it('1이면 전부', () => expect(revealLines(lines, 1)).toEqual(lines));
  it('0이면 아무것도', () => expect(revealLines(lines, 0)).toEqual(['', '']));
  it('절반이면 앞 3글자', () => expect(revealLines(lines, 0.5)).toEqual(['가나다', '']));
  it('앞줄을 다 채운 뒤 다음 줄로', () => expect(revealLines(lines, 5 / 6)).toEqual(['가나다', '라마']));
});
