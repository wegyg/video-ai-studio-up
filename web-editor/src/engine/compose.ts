/**
 * 한 프레임 합성 (R6.1, R11.8). 미리보기와 내보내기가 **같은 함수**를 쓴다.
 * 좌표는 프로젝트 해상도(예: 1080×1920) 기준이다. 호출하는 쪽에서 캔버스 배율(setTransform)을 정한다.
 * 순서: 배경(단색 또는 흐림) → 영상 트랙 아래→위 (필터·트랜지션은 WebGL 셰이더) → 텍스트 트랙(항상 맨 앞).
 * 트랜지션 구간에서는 두 클립을 각자 배치·필터까지 그린 장면 두 장을 만든 뒤 셰이더로 섞는다.
 */
import { clipAdjust, DEFAULT_BACKGROUND } from '../model/filters';
import { clipAtFrame } from '../model/keyframes';
import { TRANSITION_KINDS, visualAt } from '../model/transitions';
import { RATIO_SIZE, type ColorAdjust, type Clip, type EditState, type MediaClip, type ShapeClip, type TextClip, type Track, type Transform } from '../model/types';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface VisualSource {
  image: CanvasImageSource;
  /** 원본의 표시 크기 — 배치(맞춤) 계산에 쓴다. 실제 그림 픽셀 크기와 달라도 된다 */
  width: number;
  height: number;
  /** image 안에서 쓸 부분 (없으면 전체) */
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
}

/** 효과 처리기가 돌려주는 결과: image의 (sx, sy, sw, sh) 부분 */
export interface EffectImage {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** WebGL 효과 처리기 (src/engine/gl/effects.ts). 미리보기와 내보내기가 같은 구현을 쓴다 */
export interface Effects {
  /** 색 조정. 결과는 outW×outH (다음 호출 전에 바로 그려야 한다) */
  filter(image: CanvasImageSource, adjust: ColorAdjust, outW: number, outH: number, pxScale: number): EffectImage | null;
  /** 흐림 배경: image를 W×H에 꽉 차게 깔고 흐리게 한 그림 */
  blurFill(image: CanvasImageSource, adjust: ColorAdjust | null, W: number, H: number, amount: number): EffectImage | null;
  /** 트랜지션: 같은 크기(w×h)의 두 장면을 섞는다. kind = TRANSITION_KINDS 번호, progress 0~1 */
  transition(a: CanvasImageSource, b: CanvasImageSource, kind: number, progress: number, w: number, h: number): EffectImage | null;
}

export interface FrameSources {
  /** 영상/이미지 클립의 이 프레임 그림 (준비 안 됐으면 null) */
  visual(clip: MediaClip, frame: number): VisualSource | null;
  /** 텍스트 클립 그리기 */
  text?(ctx: Ctx2D, clip: TextClip, frame: number): void;
  /** WebGL 효과 처리기. 없으면(지원 안 함) 필터·흐림 배경 없이 그린다 */
  effects?: Effects | null;
  /** 효과를 그릴 해상도: 프로젝트 1픽셀당 몇 픽셀 (내보내기 1, 작은 미리보기는 더 작게) */
  effectScale?: number;
}

/** 이 프레임에 걸린 클립 (start ≤ frame < end) */
export function clipAt(track: Track, frame: number): Clip | undefined {
  for (const c of track.clips) {
    if (c.start > frame) break; // 시작 순 정렬
    if (frame < c.start + c.duration) return c;
  }
  return undefined;
}

/** 기본 크기: 캔버스 안에 꽉 차게 맞춤(contain) */
export function baseSize(srcW: number, srcH: number, W: number, H: number): { w: number; h: number } {
  const s = Math.min(W / srcW, H / srcH);
  return { w: srcW * s, h: srcH * s };
}

function drawVisual(ctx: Ctx2D, src: VisualSource, t: Transform, W: number, H: number) {
  const { w, h } = baseSize(src.width, src.height, W, H);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity));
  ctx.translate(W / 2 + t.x, H / 2 + t.y);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scale, t.scale);
  if (src.sw !== undefined) ctx.drawImage(src.image, src.sx ?? 0, src.sy ?? 0, src.sw, src.sh ?? 0, -w / 2, -h / 2, w, h);
  else ctx.drawImage(src.image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** 이 영상 층이 캔버스를 빈틈없이 덮는지 (덮으면 흐림 배경을 그릴 필요가 없다) */
function coversCanvas(clip: MediaClip, src: VisualSource, W: number, H: number): boolean {
  if (clip.type !== 'video') return false; // 이미지는 투명한 부분이 있을 수 있다
  const t = clip.transform;
  if (t.opacity < 0.999 || Math.abs(t.rotation % 360) > 0.01) return false;
  const { w, h } = baseSize(src.width, src.height, W, H);
  const hw = (w * t.scale) / 2;
  const hh = (h * t.scale) / 2;
  const cx = W / 2 + t.x;
  const cy = H / 2 + t.y;
  return cx - hw <= 0.5 && cx + hw >= W - 0.5 && cy - hh <= 0.5 && cy + hh >= H - 0.5;
}

interface Part {
  clip: MediaClip;
  src: VisualSource;
}
/** 영상 트랙 하나가 이 프레임에 그릴 것: 클립 하나, 또는 트랜지션 중인 두 클립 */
type Layer = { one: Part } | { from: Part | null; to: Part | null; kind: number; progress: number } | { shape: ShapeClip };

/** 트랜지션 장면용 캔버스 (미리보기·내보내기 Worker 각자 한 벌) */
const sceneCache: { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D }[] = [];
function scene(i: number, w: number, h: number): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  let s = sceneCache[i];
  if (!s) {
    const canvas = new OffscreenCanvas(w, h);
    s = sceneCache[i] = { canvas, ctx: canvas.getContext('2d')! };
  } else if (s.canvas.width !== w || s.canvas.height !== h) {
    s.canvas.width = w;
    s.canvas.height = h;
  }
  return s;
}

/** 도형 클립 (R18): 배치(위치·크기·회전·투명도)대로 단색 도형을 그린다 */
function drawShape(ctx: Ctx2D, c: ShapeClip, W: number, H: number): void {
  const t = c.transform;
  const w = c.width;
  const h = c.height;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity));
  ctx.translate(W / 2 + t.x, H / 2 + t.y);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scale, t.scale);
  ctx.beginPath();
  if (c.shape === 'circle') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (c.shape === 'triangle') {
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
  } else if (c.shape === 'rounded') ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.2);
  else ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = c.fill;
  ctx.fill();
  if (c.strokeWidth > 0) {
    ctx.lineWidth = c.strokeWidth;
    ctx.strokeStyle = c.strokeColor;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

/** 클립 하나를 배치대로 그린다 (필터가 있으면 셰이더를 거쳐서) */
function drawPart(ctx: Ctx2D, part: Part, W: number, H: number, fx: Effects | null, pxScale: number): void {
  const { clip, src } = part;
  let s = src;
  const adjust = fx ? clipAdjust(clip) : null;
  if (adjust && fx) {
    const { w, h } = baseSize(src.width, src.height, W, H);
    const out = fx.filter(src.image, adjust, w * clip.transform.scale * pxScale, h * clip.transform.scale * pxScale, pxScale);
    if (out) s = { ...src, image: out.image, sx: out.sx, sy: out.sy, sw: out.sw, sh: out.sh };
  }
  drawVisual(ctx, s, clip.transform, W, H);
}

export function drawFrame(ctx: Ctx2D, edit: EditState, frame: number, sources: FrameSources): void {
  const { width: W, height: H } = RATIO_SIZE[edit.ratio];
  const fx = sources.effects ?? null;
  const pxScale = sources.effectScale ?? 1;
  const bg = edit.background ?? DEFAULT_BACKGROUND;
  ctx.save();
  ctx.fillStyle = bg.kind === 'color' ? bg.color : '#000000';
  ctx.fillRect(0, 0, W, H);

  // 영상 층: 아래 트랙부터 위로. 효과를 쓸 수 없으면 트랜지션 없이 경계에서 바로 바뀐다
  const layers: Layer[] = [];
  const video = edit.tracks.filter((t) => t.kind === 'video');
  for (let i = video.length - 1; i >= 0; i--) {
    const v = visualAt(video[i], frame);
    if (!v) {
      const c = clipAt(video[i], frame);
      if (c?.type === 'shape') layers.push({ shape: clipAtFrame(c, frame) });
      continue;
    }
    if (v.transition && fx) {
      const a = sources.visual(v.transition.from, frame);
      const b = sources.visual(v.transition.to, frame);
      if (!a && !b) continue;
      layers.push({
        from: a ? { clip: clipAtFrame(v.transition.from, frame), src: a } : null,
        to: b ? { clip: clipAtFrame(v.transition.to, frame), src: b } : null,
        kind: TRANSITION_KINDS.indexOf(v.transition.kind),
        progress: v.progress,
      });
    } else {
      const src = sources.visual(v.clip, frame);
      // 키프레임이 있으면 이 프레임의 배치로 그린다 (model/keyframes.ts)
      if (src) layers.push({ one: { clip: clipAtFrame(v.clip, frame), src } });
    }
  }

  // 흐림 배경: 맨 아래 층을 화면에 꽉 차게 흐리게 깐다 (그 층이 화면을 다 덮으면 생략).
  // 맨 아래 층이 트랜지션 중이면 두 클립의 흐린 배경을 진행도만큼 섞는다
  if (bg.kind === 'blur' && fx && layers.length && !('shape' in layers[0])) {
    const base = layers[0];
    const parts: [Part, number][] = 'one' in base ? [[base.one, 1]] : [];
    if ('from' in base) {
      if (base.from) parts.push([base.from, 1]);
      if (base.to) parts.push([base.to, base.from ? base.progress : 1]);
    }
    if (!parts.every(([pt]) => coversCanvas(pt.clip, pt.src, W, H))) {
      for (const [pt, alpha] of parts) {
        const out = fx.blurFill(pt.src.image, clipAdjust(pt.clip), W, H, bg.amount);
        if (!out) continue;
        ctx.globalAlpha = alpha;
        ctx.drawImage(out.image, out.sx, out.sy, out.sw, out.sh, 0, 0, W, H);
      }
      ctx.globalAlpha = 1;
    }
  }

  for (const layer of layers) {
    if ('one' in layer) {
      drawPart(ctx, layer.one, W, H, fx, pxScale);
      continue;
    }
    if ('shape' in layer) {
      drawShape(ctx, layer.shape, W, H);
      continue;
    }
    // 트랜지션: 두 클립을 각자 장면으로 그린 뒤 셰이더로 섞는다 (장면 = 이 층만, 투명 배경)
    const lw = Math.max(1, Math.round(W * pxScale));
    const lh = Math.max(1, Math.round(H * pxScale));
    const paint = (i: number, part: Part | null) => {
      const sc = scene(i, lw, lh);
      sc.ctx.setTransform(1, 0, 0, 1, 0, 0);
      sc.ctx.clearRect(0, 0, lw, lh);
      sc.ctx.setTransform(lw / W, 0, 0, lh / H, 0, 0);
      if (part) drawPart(sc.ctx, part, W, H, fx, pxScale);
      return sc.canvas;
    };
    const a = paint(0, layer.from);
    const b = paint(1, layer.to);
    const out = fx!.transition(a, b, layer.kind, layer.progress, lw, lh);
    if (out) ctx.drawImage(out.image, out.sx, out.sy, out.sw, out.sh, 0, 0, W, H);
  }

  if (sources.text) {
    const text = edit.tracks.filter((t) => t.kind === 'text');
    for (let i = text.length - 1; i >= 0; i--) {
      const c = clipAt(text[i], frame);
      if (c?.type === 'text') sources.text(ctx, clipAtFrame(c, frame), frame);
    }
  }
  ctx.restore();
}
