/**
 * 텍스트 배치와 그리기 (R7). 미리보기와 내보내기가 같은 함수를 쓴다.
 * 좌표는 프로젝트 해상도 기준. 측정은 화면과 Worker 모두에서 되도록 OffscreenCanvas를 쓴다.
 */
import type { TextAnim, TextClip, TextStyle } from '../model/types';
import type { Ctx2D } from './compose';

/** 쇼츠·릴스 UI에 가려지는 영역 비율 (R7.9). 자동 줄바꿈 너비 기준이기도 하다 */
export const SAFE_AREA = { top: 0.08, bottom: 0.18, side: 0.05 };

export interface SafeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function safeArea(W: number, H: number): SafeBox {
  return { x: W * SAFE_AREA.side, y: H * SAFE_AREA.top, w: W * (1 - SAFE_AREA.side * 2), h: H * (1 - SAFE_AREA.top - SAFE_AREA.bottom) };
}

let measureCtx: Ctx2D | null = null;
function ctxForMeasure(): Ctx2D {
  measureCtx ??= new OffscreenCanvas(8, 8).getContext('2d')!;
  return measureCtx;
}

export function fontString(style: Pick<TextStyle, 'font' | 'size' | 'weight'>): string {
  return `${style.weight} ${style.size}px "${style.font}", sans-serif`;
}

/**
 * 자동 줄바꿈 (R7.8). 한글은 글자 단위로 끊으면 읽기 나빠서 띄어쓰기 단위로 끊고,
 * 한 낱말이 한 줄보다 길 때만 글자 단위로 나눈다. 사용자가 넣은 줄바꿈(\n)은 그대로 지킨다.
 */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    const words = para.split(' ');
    let line = '';
    const pushLine = () => {
      out.push(line);
      line = '';
    };
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth || !line) {
        // 낱말 하나가 한 줄보다 길면 글자 단위로 나눈다
        if (measure(candidate) > maxWidth && !line) {
          let chunk = '';
          for (const ch of word) {
            if (chunk && measure(chunk + ch) > maxWidth) {
              out.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        } else {
          line = candidate;
        }
      } else {
        pushLine();
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  /** 글자 영역 크기(박스 여백 제외) */
  textW: number;
  textH: number;
  /** 박스 여백을 포함한 전체 크기 (선택 상자 크기) */
  width: number;
  height: number;
}

/** 줄바꿈과 크기 계산. 폭은 안전 영역 너비를 넘지 않는다. */
export function layoutText(clip: TextClip, W: number, H: number): TextLayout {
  const ctx = ctxForMeasure();
  ctx.font = fontString(clip);
  const pad = clip.box.enabled ? clip.box.padding : 0;
  const maxWidth = Math.max(clip.size, safeArea(W, H).w - pad * 2);
  const lines = wrapLines(clip.text, maxWidth, (s) => ctx.measureText(s).width);
  const lineHeight = clip.size * clip.lineHeight;
  const textW = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const textH = lineHeight * lines.length;
  return { lines, lineHeight, textW, textH, width: textW + pad * 2, height: textH + pad * 2 };
}

// --- 애니메이션 -------------------------------------------------------------
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export interface AnimState {
  alpha: number;
  scale: number;
  dx: number;
  dy: number;
  /** 타자기: 보여 줄 글자 수 비율(0~1). 1이면 전부 */
  reveal: number;
}

const NEUTRAL: AnimState = { alpha: 1, scale: 1, dx: 0, dy: 0, reveal: 1 };

/** 한쪽(등장 또는 퇴장) 애니메이션의 진행도 p(0=시작 상태, 1=제자리)를 상태로 바꾼다 */
function stateFor(type: TextAnim['type'], p: number, size: number): AnimState {
  const e = easeOutCubic(p);
  switch (type) {
    case 'none':
      return NEUTRAL;
    case 'fade':
      return { ...NEUTRAL, alpha: p };
    case 'pop':
      return { ...NEUTRAL, alpha: clamp01(p * 2), scale: 0.6 + 0.4 * easeOutBack(p) };
    case 'typewriter':
      return { ...NEUTRAL, reveal: p };
    case 'slideUp':
      return { ...NEUTRAL, alpha: clamp01(p * 1.5), dy: (1 - e) * size * 1.5 };
    case 'slideDown':
      return { ...NEUTRAL, alpha: clamp01(p * 1.5), dy: -(1 - e) * size * 1.5 };
    case 'slideLeft':
      return { ...NEUTRAL, alpha: clamp01(p * 1.5), dx: (1 - e) * size * 3 };
    case 'slideRight':
      return { ...NEUTRAL, alpha: clamp01(p * 1.5), dx: -(1 - e) * size * 3 };
    case 'bounce':
      return { ...NEUTRAL, alpha: clamp01(p * 2), dy: -(1 - easeOutBounce(p)) * size * 2 };
    case 'zoom':
      return { ...NEUTRAL, alpha: clamp01(p * 1.5), scale: 2 - e };
  }
}

/** 이 프레임의 애니메이션 상태. 등장과 퇴장이 겹치면 둘을 곱해 합친다. */
export function animState(clip: TextClip, frame: number): AnimState {
  const t = frame - clip.start;
  const inDur = clip.animIn.type === 'none' ? 0 : clip.animIn.duration;
  const outDur = clip.animOut.type === 'none' ? 0 : clip.animOut.duration;
  const pIn = inDur > 0 ? clamp01(t / inDur) : 1;
  const pOut = outDur > 0 ? clamp01((clip.duration - t) / outDur) : 1;
  const a = stateFor(clip.animIn.type, pIn, clip.size);
  const b = stateFor(clip.animOut.type, pOut, clip.size);
  return {
    alpha: a.alpha * b.alpha,
    scale: a.scale * b.scale,
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    reveal: Math.min(a.reveal, b.reveal),
  };
}

/** 타자기 효과로 잘라낸 줄 목록 */
export function revealLines(lines: string[], reveal: number): string[] {
  if (reveal >= 1) return lines;
  const total = lines.reduce((n, l) => n + l.length, 0);
  let left = Math.floor(total * clamp01(reveal));
  return lines.map((l) => {
    const take = Math.min(l.length, Math.max(0, left));
    left -= take;
    return l.slice(0, take);
  });
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 텍스트 클립 한 개를 그린다 (배경 박스 → 그림자/외곽선 → 글자) */
export function drawTextClip(ctx: Ctx2D, clip: TextClip, W: number, H: number, frame: number): void {
  const anim = animState(clip, frame);
  const alpha = clamp01(clip.transform.opacity) * clamp01(anim.alpha);
  if (alpha <= 0.001) return;
  const layout = layoutText(clip, W, H);
  const lines = revealLines(layout.lines, anim.reveal);
  if (lines.every((l) => l === '')) return;

  const t = clip.transform;
  const scale = t.scale * anim.scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2 + t.x + anim.dx, H / 2 + t.y + anim.dy);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(scale, scale);

  const { lineHeight, textW, textH } = layout;
  if (clip.box.enabled) {
    ctx.save();
    ctx.globalAlpha = alpha * clamp01(clip.box.opacity);
    ctx.fillStyle = clip.box.color;
    roundRect(ctx, -textW / 2 - clip.box.padding, -textH / 2 - clip.box.padding, textW + clip.box.padding * 2, textH + clip.box.padding * 2, clip.box.radius);
    ctx.fill();
    ctx.restore();
  }

  ctx.font = fontString(clip);
  ctx.textAlign = clip.align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const anchorX = clip.align === 'left' ? -textW / 2 : clip.align === 'right' ? textW / 2 : 0;
  lines.forEach((line, i) => {
    if (!line) return;
    const y = -textH / 2 + lineHeight * (i + 0.5);
    if (clip.shadow.enabled) {
      ctx.save();
      ctx.shadowColor = clip.shadow.color;
      ctx.shadowBlur = clip.shadow.blur;
      ctx.shadowOffsetX = clip.shadow.offsetX;
      ctx.shadowOffsetY = clip.shadow.offsetY;
      // 그림자만 얻기 위해 글자를 같은 자리에 한 번 그린다 (네온 느낌은 두 번 겹쳐 진하게)
      ctx.fillStyle = clip.color;
      ctx.fillText(line, anchorX, y);
      if (clip.shadow.blur > 20) ctx.fillText(line, anchorX, y);
      ctx.restore();
    }
    if (clip.stroke.width > 0) {
      ctx.strokeStyle = clip.stroke.color;
      ctx.lineWidth = clip.stroke.width;
      ctx.strokeText(line, anchorX, y);
    }
    ctx.fillStyle = clip.color;
    ctx.fillText(line, anchorX, y);
  });
  ctx.restore();
}
