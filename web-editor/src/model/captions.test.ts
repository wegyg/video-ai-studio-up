import { describe, expect, it } from 'vitest';
import { buildCaptions, type AsrWord } from './captions';

const w = (text: string, start: number, end: number): AsrWord => ({ text, start, end });
const line = (words: AsrWord[]) => buildCaptions(words, { style: 'line', fps: 30 });

describe('자막 만들기 (R20)', () => {
  it('글자 수가 넘치면 줄을 바꾼다', () => {
    const out = line([w('안녕하세요', 0, 0.6), w('오늘은', 0.7, 1.1), w('카페를', 1.15, 1.6), w('소개합니다', 1.65, 2.4)]);
    expect(out.map((c) => c.text)).toEqual(['안녕하세요 오늘은 카페를', '소개합니다']);
    expect([out[0].start, out[0].duration]).toEqual([0, 48]);
    expect([out[1].start, out[1].duration]).toEqual([50, 22]);
  });

  it('0.6초 넘게 쉬면, 문장이 끝나면(.!?) 줄을 바꾼다', () => {
    expect(line([w('첫째', 0, 0.4), w('둘째', 1.3, 1.7)]).map((c) => c.text)).toEqual(['첫째', '둘째']);
    expect(line([w('끝.', 0, 0.4), w('다음', 0.5, 0.9)]).map((c) => c.text)).toEqual(['끝.', '다음']);
    expect(line([w('짧게', 0, 0.4), w('이어서', 0.5, 0.9)]).map((c) => c.text)).toEqual(['짧게 이어서']);
  });

  it('한 줄이 3초를 넘지 않는다', () => {
    const syllables = ['가', '나', '다', '라', '마', '바', '사', '아'];
    const many = syllables.map((t, i) => w(t, i * 0.5, i * 0.5 + 0.45));
    const out = line(many);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.duration).toBeLessThanOrEqual(90);
  });

  it('단어 강조는 단어마다 하나, 서로 겹치지 않는다', () => {
    const out = buildCaptions([w('하나', 0, 0.5), w('둘', 0.5, 0.55), w('셋', 1.2, 2.0)], { style: 'word', fps: 30 });
    expect(out.map((c) => c.text)).toEqual(['하나', '둘', '셋']);
    expect(out[0].duration).toBe(15);
    expect(out[1].duration).toBe(8); // 아주 짧은 단어도 최소 길이만큼 보인다
    expect(out[2].duration).toBe(24);
    for (let i = 0; i < out.length - 1; i++) expect(out[i].start + out[i].duration).toBeLessThanOrEqual(out[i + 1].start);
  });

  it('같은 말이 끝없이 반복되면(환청) 합치고, 아주 긴 단어는 자른다', () => {
    const loop = Array.from({ length: 12 }, (_, i) => w('끝', i * 0.2, i * 0.2 + 0.2));
    const out = buildCaptions(loop, { style: 'word', fps: 30 });
    expect(out.map((c) => c.text)).toEqual(['끝', '끝']);
    expect(out[1].duration).toBe(66); // 반복된 만큼 뒤 자막이 길어진다
    const long = line([w('가'.repeat(60), 0, 1)]);
    expect(long[0].text).toHaveLength(24);
  });

  it('겹치면 앞 자막을 줄이고, 이상한 값은 버린다', () => {
    const out = buildCaptions([w('가', 0, 5), w('나', 0.2, 0.6)], { style: 'word', fps: 30 });
    expect([out[0].start, out[0].duration]).toEqual([0, 6]);
    expect(line([])).toEqual([]);
    expect(line([w('  ', 0, 1), w('값', -5, 1)])).toEqual([]);
    expect(line([w('끝없음', 1, Number.NaN)])).toEqual([{ start: 30, duration: 12, text: '끝없음' }]);
  });
});
