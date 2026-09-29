/**
 * 한 프레임 합성 (R6.1, R11.8). 미리보기와 내보내기가 **같은 함수**를 쓴다.
 * 좌표는 프로젝트 해상도(예: 1080×1920) 기준이다. 호출하는 쪽에서 캔버스 배율(setTransform)을 정한다.
 * 순서: 검은 배경 → 영상 트랙 아래→위 → 텍스트 트랙(항상 맨 앞, 태스크 7).
 */
import { RATIO_SIZE, type Clip, type EditState, type MediaClip, type TextClip, type Track, type Transform } from '../model/types';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface VisualSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface FrameSources {
  /** 영상/이미지 클립의 이 프레임 그림 (준비 안 됐으면 null) */
  visual(clip: MediaClip, frame: number): VisualSource | null;
  /** 텍스트 클립 그리기 */
  text?(ctx: Ctx2D, clip: TextClip, frame: number): void;
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
  ctx.drawImage(src.image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

export function drawFrame(ctx: Ctx2D, edit: EditState, frame: number, sources: FrameSources): void {
  const { width: W, height: H } = RATIO_SIZE[edit.ratio];
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const video = edit.tracks.filter((t) => t.kind === 'video');
  for (let i = video.length - 1; i >= 0; i--) {
    const c = clipAt(video[i], frame);
    if (!c || c.type === 'text' || c.type === 'audio') continue;
    const src = sources.visual(c, frame);
    if (src) drawVisual(ctx, src, c.transform, W, H);
  }
  if (sources.text) {
    const text = edit.tracks.filter((t) => t.kind === 'text');
    for (let i = text.length - 1; i >= 0; i--) {
      const c = clipAt(text[i], frame);
      if (c?.type === 'text') sources.text(ctx, c, frame);
    }
  }
  ctx.restore();
}
