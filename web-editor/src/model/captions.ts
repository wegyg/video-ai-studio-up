/**
 * 자동 자막: 인식된 단어(초 단위 시각)를 자막 클립 목록(프레임 단위)으로 바꾼다 (R20).
 * 순수 함수라 단위 테스트로 규칙을 고정한다. 인식 결과 → 텍스트 클립 변환은 여기 한 곳에서만 한다.
 */
export interface AsrWord {
  text: string;
  /** 초 */
  start: number;
  end: number;
}

/** 문장 자막(한 줄씩) / 단어 강조(한 단어씩 나타남) */
export type CaptionStyle = 'line' | 'word';

export interface CaptionSpec {
  /** 타임라인 프레임 */
  start: number;
  duration: number;
  text: string;
}

/** 한 줄에 넣을 최대 글자 수 (한글 기준, 쇼츠 화면에서 두 줄이 되지 않는 길이) */
export const CAPTION_MAX_CHARS = 18;
/** 한 줄 자막의 최대 길이 (3초) */
export const CAPTION_MAX_FRAMES = 90;
/** 이만큼 쉬면 줄을 바꾼다 (0.6초) */
export const CAPTION_GAP_FRAMES = 18;
/** 자막이 너무 짧아 읽을 수 없으면 이만큼 늘린다 */
export const CAPTION_MIN_FRAMES = 12;
/** 단어 강조 자막의 최소 길이 */
export const WORD_MIN_FRAMES = 8;
/** 한 단어의 최대 글자 수. Whisper가 말이 없는 구간에서 같은 글자를 끝없이 내놓는 일이 있어 잘라 둔다 */
export const WORD_MAX_CHARS = 24;
/** 같은 단어가 이어질 수 있는 최대 횟수 (환청 반복 줄이기) */
export const MAX_REPEAT = 2;

const SENTENCE_END = /[.!?。！？…]$/;

export interface BuildOptions {
  style: CaptionStyle;
  fps: number;
  maxChars?: number;
  maxFrames?: number;
  gapFrames?: number;
  minFrames?: number;
}

/**
 * 인식 결과 정리: 빈 단어·이상한 시각을 버리고 시간 순으로 세운다.
 * 너무 긴 단어는 자르고, 같은 단어가 세 번 넘게 이어지면 하나로 합친다
 * (Whisper는 말이 없는 구간에서 같은 말을 끝없이 반복하는 일이 있다 — docs/whisper.md).
 */
function clean(words: readonly AsrWord[]): AsrWord[] {
  const sorted = words
    .map((w) => ({ text: w.text.trim().slice(0, WORD_MAX_CHARS), start: w.start, end: w.end }))
    .filter((w) => w.text !== '' && Number.isFinite(w.start) && w.start >= 0)
    .map((w) => ({ ...w, end: Number.isFinite(w.end) && w.end > w.start ? w.end : w.start + 0.25 }))
    .sort((a, b) => a.start - b.start);
  const out: AsrWord[] = [];
  for (const w of sorted) {
    const n = out.length;
    if (n >= MAX_REPEAT && out.slice(n - MAX_REPEAT).every((p) => p.text === w.text)) {
      out[n - 1].end = Math.max(out[n - 1].end, w.end); // 반복은 앞 자막을 늘리는 것으로 끝낸다
      continue;
    }
    out.push(w);
  }
  return out;
}

/** 뒤 자막과 겹치지 않게 길이를 줄인다 (자막은 겹치면 두 개가 동시에 보인다) */
function noOverlap(specs: CaptionSpec[]): CaptionSpec[] {
  for (let i = 0; i < specs.length - 1; i++) {
    const room = specs[i + 1].start - specs[i].start;
    if (room >= 1 && specs[i].duration > room) specs[i].duration = room;
  }
  return specs.filter((s) => s.duration >= 1);
}

export function buildCaptions(words: readonly AsrWord[], opts: BuildOptions): CaptionSpec[] {
  const { style, fps } = opts;
  const maxChars = opts.maxChars ?? CAPTION_MAX_CHARS;
  const maxFrames = opts.maxFrames ?? CAPTION_MAX_FRAMES;
  const gapFrames = opts.gapFrames ?? CAPTION_GAP_FRAMES;
  const minFrames = opts.minFrames ?? (style === 'word' ? WORD_MIN_FRAMES : CAPTION_MIN_FRAMES);
  const list = clean(words);
  if (!list.length) return [];

  const spec = (text: string, start: number, end: number): CaptionSpec => {
    const s = Math.max(0, Math.round(start * fps));
    // 한 자막은 최소 minFrames, 최대 maxFrames (한 단어가 아주 길어도 화면에 붙어 있지 않게)
    return { start: s, duration: Math.min(maxFrames, Math.max(minFrames, Math.round(end * fps) - s)), text };
  };

  if (style === 'word') return noOverlap(list.map((w) => spec(w.text, w.start, w.end)));

  const out: CaptionSpec[] = [];
  let group: AsrWord[] = [];
  const flush = () => {
    if (!group.length) return;
    out.push(spec(group.map((w) => w.text).join(' '), group[0].start, group[group.length - 1].end));
    group = [];
  };
  for (const w of list) {
    const prev = group[group.length - 1];
    if (prev) {
      const chars = group.reduce((n, g) => n + g.text.length + 1, 0) - 1 + 1 + w.text.length;
      const tooLong = chars > maxChars;
      const tooSlow = (w.end - group[0].start) * fps > maxFrames;
      const gap = (w.start - prev.end) * fps > gapFrames;
      if (tooLong || tooSlow || gap || SENTENCE_END.test(prev.text)) flush();
    }
    group.push(w);
  }
  flush();
  return noOverlap(out);
}
