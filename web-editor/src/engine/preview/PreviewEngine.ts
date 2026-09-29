/**
 * 실시간 미리보기 엔진 (R6). 렌더링 대기 없이 Canvas + <video>로 합성한다.
 *
 * - 그리기: requestAnimationFrame(최대 60fps). 재생 중에는 매 화면 갱신마다, 정지 중에는 바뀐 것이 있을 때만.
 * - 시계: 재생 중 기준 시계는 AudioContext.currentTime(오디오 하드웨어 시계). 미디어 요소마다 기준에서 벗어나면
 *   재생 속도를 조금 바꿔(최대 ±10%) 따라오게 하고, 크게 벗어나면 다시 탐색한다 (R6.5).
 * - 미디어 요소 풀: 현재 위치 기준 앞 2초 ~ 뒤 1초 안의 영상/오디오 클립만 요소를 만든다(다음 클립 미리 준비).
 * - 정지/스크럽: 요소의 currentTime을 해당 프레임으로 옮기고 'seeked' 뒤에 다시 그린다.
 *   빠르게 스크럽하면 마지막 요청만 처리한다.
 * - 소리: 요소 → MediaElementAudioSourceNode → 클립 GainNode(볼륨×페이드, 트랙 음소거) → 마스터 → 출력.
 */
import { sourceBlobs, useMedia } from '../../media/store';
import { gainAt } from '../../model/audio';
import { findClip } from '../../model/ops';
import { editDuration } from '../../model/time';
import { FPS, RATIO_SIZE, type Clip, type EditState, type MediaClip } from '../../model/types';
import { useProject } from '../../store/project';
import { useUI } from '../../store/ui';
import { clipAt, drawFrame, type FrameSources } from '../compose';
import { sharedEffects } from '../gl/effects';
import { needsEffects } from '../../model/filters';
import { sourceFrame, srcAt, visibleRange } from '../../model/transitions';
import { transformAt } from '../../model/keyframes';
import { clipBox, containsPoint, textBox, type Box, type Point } from '../geometry';
import { drawTextClip, layoutText } from '../text';
import { ensureFont, isFontLoaded, type FontFamily, type FontWeight } from '../../fonts';

const PRELOAD = 2 * FPS;
const KEEP = FPS;
const START_WAIT_MS = 400;
const HARD_DRIFT = 0.3;
const SOFT_DRIFT = 0.03;
const CALM_DRIFT = 0.01;
const IMAGE_MAX = 2160;
/** 탐색 목표에 더하는 여유(초): 부동소수점 오차로 앞 프레임이 잡히지 않게 */
const SEEK_EPS = 0.001;

class AudioGraph {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  readonly master = this.ctx.createGain();
  readonly analyser = this.ctx.createAnalyser();
  private buf = new Float32Array(2048);
  constructor() {
    this.analyser.fftSize = 2048;
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }
  route(el: HTMLMediaElement) {
    const src = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.master);
    return { src, gain };
  }
  /** 출력 소리 크기(RMS) — 테스트/표시용 */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return Math.sqrt(s / this.buf.length);
  }
}

interface Want {
  clip: MediaClip;
  muted: boolean;
  /** 화면에 보이는 구간 (트랜지션이 있으면 클립 범위보다 넓다) */
  ext: { start: number; end: number };
  /** 원본 전체 프레임 수 (모르면 여분을 쓰지 않는다) */
  srcFrames: number | undefined;
}

class Slot {
  readonly el: HTMLMediaElement;
  audio: { src: MediaElementAudioSourceNode; gain: GainNode } | null = null;
  clip: MediaClip;
  seeking = false;
  advancing = false;
  playStartedAt = 0;
  private requested = NaN;
  private pending: number | null = null;

  constructor(clip: MediaClip, url: string, holder: HTMLElement, onChange: () => void) {
    this.clip = clip;
    const el = document.createElement(clip.type === 'video' ? 'video' : 'audio');
    el.preload = 'auto';
    if (el instanceof HTMLVideoElement) {
      el.playsInline = true;
      el.disablePictureInPicture = true;
    }
    el.addEventListener('seeked', () => {
      this.seeking = false;
      if (this.pending !== null) {
        const t = this.pending;
        this.pending = null;
        this.seek(t);
      }
      onChange();
    });
    el.addEventListener('loadeddata', onChange);
    el.addEventListener('playing', () => {
      this.advancing = true;
      onChange();
    });
    el.addEventListener('pause', () => (this.advancing = false));
    el.addEventListener('waiting', () => (this.advancing = false));
    el.src = url;
    holder.appendChild(el);
    this.el = el;
  }

  /** 정지 상태에서 t(초)로 이동. 같은 목표는 한 번만, 탐색 중이면 마지막 요청만 남긴다 */
  seekTo(t: number): void {
    if (t === this.requested) return;
    this.requested = t;
    if (this.seeking) this.pending = t;
    else this.seek(t);
  }
  private seek(t: number): void {
    this.seeking = true;
    this.el.currentTime = t;
  }
  /** 재생으로 위치가 움직였으니 다음 정지 탐색은 새로 한다 */
  forgetTarget(): void {
    this.requested = NaN;
  }
  get settled(): boolean {
    return !this.seeking && this.pending === null && this.el.readyState >= 2;
  }
  setRate(r: number): void {
    if (Math.abs(this.el.playbackRate - r) > 0.004) this.el.playbackRate = r;
  }
  dispose(): void {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.el.remove();
    this.audio?.src.disconnect();
    this.audio?.gain.disconnect();
  }
}

export interface PreviewStats {
  playing: boolean;
  starting: boolean;
  renderedFrame: number;
  ready: boolean;
  slots: number;
  audioState: string;
  level: number;
  /** 최근 2초 동안 미디어 요소와 기준 시계의 최대 차이(초) */
  maxDrift: number;
  /** 최근 1초 동안 그린 횟수 */
  drawFps: number;
  /** 최근 1초 동안 그리기 사이 최대 간격(ms) */
  maxGapMs: number;
}

export class PreviewEngine {
  private ctx: CanvasRenderingContext2D;
  private holder: HTMLDivElement;
  private slots = new Map<string, Slot>();
  private images = new Map<string, ImageBitmap | 'loading' | 'error'>();
  private audio: AudioGraph | null = null;
  private raf = 0;
  private dirty = true;
  private playing = false;
  private starting = false;
  private startDeadline = 0;
  private frameBase = 0;
  private clockBase = 0;
  private clockAudio = false;
  private selfSet = false;
  private unsubs: (() => void)[] = [];
  private renderedFrame = -1;
  private ready = false;
  private draws: number[] = [];
  private drifts: { t: number; d: number }[] = [];
  private fontsReady = new Set<string>();
  private fontsLoading = new Set<string>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.holder = document.createElement('div');
    this.holder.setAttribute('aria-hidden', 'true');
    this.holder.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    document.body.appendChild(this.holder);
    this.unsubs.push(
      useProject.subscribe((s, p) => {
        if (s.edit !== p.edit) this.invalidate();
      }),
      useMedia.subscribe(() => this.invalidate()),
      useUI.subscribe((s, p) => {
        if (s.playing !== p.playing) {
          if (s.playing) this.startPlayback();
          else this.stopPlayback();
        } else if (s.playhead !== p.playhead && !this.selfSet) {
          if (this.playing) this.rebase(s.playhead);
          this.invalidate();
        }
      }),
    );
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.unsubs.forEach((u) => u());
    this.slots.forEach((s) => s.dispose());
    this.slots.clear();
    this.images.forEach((b) => b instanceof ImageBitmap && b.close());
    this.images.clear();
    void this.audio?.ctx.close();
    this.audio = null;
    this.holder.remove();
  }

  /** 미리보기 상자 크기(CSS px)에 맞춰 캔버스 해상도를 정한다 (프로젝트 해상도 이하) */
  resize(cssW: number, cssH: number, dpr: number): void {
    if (cssW <= 0 || cssH <= 0) return;
    const { width: W, height: H } = RATIO_SIZE[useProject.getState().edit.ratio];
    const pw = Math.max(1, Math.min(W, Math.round(cssW * dpr)));
    const ph = Math.max(1, Math.round((pw * H) / W));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.invalidate();
  }

  invalidate = (): void => {
    this.dirty = true;
  };

  private setPlayheadSelf(f: number): void {
    this.selfSet = true;
    useUI.getState().setPlayhead(f);
    this.selfSet = false;
  }

  private now(): number {
    return this.clockAudio && this.audio ? this.audio.ctx.currentTime : performance.now() / 1000;
  }

  private startPlayback(): void {
    const total = editDuration(useProject.getState().edit);
    if (total === 0) {
      queueMicrotask(() => useUI.getState().setPlaying(false));
      return;
    }
    // 사용자 입력(클릭/키) 처리 중에 불리므로 여기서 AudioContext를 만들고 깨운다 (자동 재생 정책)
    this.audio ??= new AudioGraph();
    void this.audio.ctx.resume();
    let ph = useUI.getState().playhead;
    if (ph >= total) {
      ph = 0;
      this.setPlayheadSelf(0);
    }
    this.playing = true;
    this.starting = true;
    this.frameBase = ph;
    this.startDeadline = performance.now() + START_WAIT_MS;
    for (const s of this.slots.values()) this.routeAudio(s);
    this.invalidate();
  }

  private stopPlayback(): void {
    if (!this.playing) return;
    this.playing = false;
    this.starting = false;
    for (const s of this.slots.values()) {
      s.el.pause();
      s.setRate(1);
      s.forgetTarget();
      if (s.audio && this.audio) s.audio.gain.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.01);
    }
    // 구간 미리 재생이었으면 원래 보던 곳으로 돌아간다
    const range = useUI.getState().playRange;
    if (range) {
      useUI.getState().setPlayRange(null);
      useUI.getState().setPlayhead(range.returnTo);
    }
    this.invalidate();
  }

  /** 재생 중에 위치가 바뀌면(탐색) 시계를 새 위치에서 다시 시작 */
  private rebase(frame: number): void {
    if (useUI.getState().playRange) useUI.getState().setPlayRange(null); // 사용자가 옮겼으면 미리 재생은 끝
    this.starting = true;
    this.frameBase = frame;
    this.startDeadline = performance.now() + START_WAIT_MS;
    for (const s of this.slots.values()) {
      s.el.pause();
      s.forgetTarget();
    }
  }

  private routeAudio(s: Slot): void {
    if (s.audio) return;
    if (!useProject.getState().assets[s.clip.assetId]?.hasAudio) {
      // 소리를 읽지 못한(또는 소리가 없는) 파일: 볼륨/음소거를 거치지 않는 소리가 나지 않게 요소를 음소거
      s.el.muted = true;
      return;
    }
    if (this.audio) s.audio = this.audio.route(s.el);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.tick();
  };

  private tick(): void {
    const edit = useProject.getState().edit;
    const total = editDuration(edit);
    let frame: number;
    if (this.playing && !this.starting) {
      frame = this.frameBase + (this.now() - this.clockBase) * FPS;
      const range = useUI.getState().playRange;
      if (range && frame >= range.end) {
        useUI.getState().setPlaying(false); // → stopPlayback가 returnTo로 되돌린다
        return;
      }
      if (frame >= total) {
        frame = total;
        this.setPlayheadSelf(total);
        useUI.getState().setPlaying(false); // → stopPlayback
      } else {
        const f = Math.floor(frame);
        if (f !== useUI.getState().playhead) this.setPlayheadSelf(f);
      }
    } else if (this.playing) {
      frame = this.frameBase;
    } else {
      frame = useUI.getState().playhead;
    }
    this.syncSlots(edit, frame);
    if (this.playing && this.starting) this.maybeStartClock(frame);
    if (this.playing || this.dirty) this.draw(edit, frame);
  }

  private syncSlots(edit: EditState, frame: number): void {
    const want = new Map<string, Want>();
    for (const tr of edit.tracks) {
      if (tr.kind === 'text') continue;
      for (const c of tr.clips) {
        if (c.type !== 'video' && c.type !== 'audio') continue;
        // 트랜지션 구간에서는 자기 범위 밖에서도 보인다 (model/transitions.ts)
        const ext = visibleRange(tr, c);
        if (frame >= ext.start - PRELOAD && frame < ext.end + KEEP) {
          const srcFrames = useProject.getState().assets[c.assetId]?.durationFrames;
          want.set(c.id, { clip: c, muted: tr.muted, ext, srcFrames });
        }
      }
    }
    for (const [id, s] of this.slots) {
      const w = want.get(id);
      if (!w || w.clip.assetId !== s.clip.assetId) {
        s.dispose();
        this.slots.delete(id);
      }
    }
    for (const [id, w] of want) {
      const { clip } = w;
      let s = this.slots.get(id);
      if (!s) {
        const url = useMedia.getState().entries[clip.assetId]?.url;
        if (!url) continue;
        s = new Slot(clip, url, this.holder, this.invalidate);
        this.slots.set(id, s);
        this.routeAudio(s);
      }
      s.clip = clip;
      this.control(s, w, frame);
    }
  }

  private control(s: Slot, { clip, muted, ext, srcFrames }: Want, frame: number): void {
    const local = frame - clip.start;
    const active = local >= 0 && local < clip.duration; // 소리가 나는 범위 = 클립 자기 범위
    // 화면: 트랜지션 구간(ext)에서는 원본의 앞뒤 여분을 이어서 재생하고, 여분이 없으면 끝 프레임에 멈춘다
    const want = srcAt(clip, frame); // 원본 프레임 (속도 반영)
    const holding = srcFrames === undefined ? !active : want < 0 || want > srcFrames - 1;
    const speed = clip.speed || 1;
    // 속도: 요소 재생 속도 = 클립 속도, 음 높이 유지 여부는 브라우저 기능(preservesPitch)
    const keep = clip.keepPitch !== false;
    if (s.el.preservesPitch !== keep) s.el.preservesPitch = keep;
    const visible = clip.type === 'video' && frame >= ext.start && frame < ext.end && !holding;
    const shown = Math.min(Math.max(Math.floor(frame), ext.start), ext.end - 1);
    const frameSrc = sourceFrame(clip, shown, srcFrames) / FPS;
    if (this.playing && (active || visible)) {
      const exact = want / FPS;
      if (s.el.ended && exact >= s.el.duration - 0.05) {
        // 원본 끝까지 재생했다: 마지막 프레임에 멈춰 둔다 (끝난 요소에 play()를 부르면 처음으로 돌아간다)
      } else if (s.el.paused) {
        if (Math.abs(s.el.currentTime - exact) > 0.05) s.el.currentTime = exact + SEEK_EPS;
        s.setRate(speed);
        s.forgetTarget();
        s.playStartedAt = performance.now();
        s.el.play().catch(() => undefined);
      } else if (!this.starting && s.advancing) {
        const drift = exact - s.el.currentTime; // +: 요소가 늦음
        const a = Math.abs(drift);
        if (a > HARD_DRIFT * speed) s.el.currentTime = exact;
        else if (a > SOFT_DRIFT * speed) s.setRate(speed * (1 + Math.max(-0.1, Math.min(0.1, (drift * 1.5) / speed))));
        else if (a < CALM_DRIFT * speed) s.setRate(speed);
        if (performance.now() - s.playStartedAt > 800) this.drifts.push({ t: performance.now(), d: a });
      }
      if (s.audio && this.audio) s.audio.gain.gain.setTargetAtTime(muted || !active ? 0 : gainAt(clip, frame), this.audio.ctx.currentTime, 0.015);
    } else {
      if (!s.el.paused) {
        s.el.pause();
        s.forgetTarget();
      }
      s.setRate(1);
      s.seekTo(frameSrc + SEEK_EPS);
      if (s.audio && this.audio && this.playing) s.audio.gain.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.01);
    }
  }

  /** 재생 시작: 지금 보이는 미디어가 실제로 움직이기 시작하면(또는 잠시 기다린 뒤) 시계를 켠다 */
  private maybeStartClock(frame: number): void {
    const active = [...this.slots.values()].filter((s) => frame >= s.clip.start && frame < s.clip.start + s.clip.duration);
    const audioReady = !this.audio || this.audio.ctx.state === 'running';
    const go = active.every((s) => s.advancing) && audioReady;
    if (!go && performance.now() < this.startDeadline) return;
    this.starting = false;
    this.clockAudio = !!this.audio && this.audio.ctx.state === 'running';
    this.clockBase = this.now();
    // 기준 요소(첫 활성 미디어)의 실제 위치에 시계를 맞춰 시작 순간의 차이를 없앤다
    const ref = active.find((s) => s.advancing);
    if (ref) this.frameBase = ref.clip.start + (ref.el.currentTime * FPS - ref.clip.inPoint) / (ref.clip.speed || 1);
    for (const s of active) s.playStartedAt = performance.now();
  }

  /** 텍스트 글꼴이 준비됐는지. 아직이면 불러오기를 시작하고 false */
  private ensureTextFont(family: FontFamily, weight: FontWeight): boolean {
    const key = `${family}:${weight}`;
    if (this.fontsReady.has(key)) return true;
    // 미리 불러 둔 글꼴이면 이번 프레임에 바로 그린다 (프리셋을 누르자마자 보이게)
    if (isFontLoaded(family, weight)) {
      this.fontsReady.add(key);
      return true;
    }
    if (!this.fontsLoading.has(key)) {
      this.fontsLoading.add(key);
      ensureFont(family, weight).then(
        () => {
          this.fontsReady.add(key);
          this.invalidate();
        },
        () => {
          this.fontsReady.add(key); // 실패해도 기본 글꼴로 그린다 (영원히 빈 화면이 되지 않게)
          this.invalidate();
        },
      );
    }
    return false;
  }

  private image(assetId: string): ImageBitmap | null {
    const v = this.images.get(assetId);
    if (v instanceof ImageBitmap) return v;
    if (v === undefined) {
      const blob = sourceBlobs.get(assetId);
      const meta = useProject.getState().assets[assetId];
      if (!blob || !meta?.width || !meta.height) return null;
      this.images.set(assetId, 'loading');
      const s = Math.min(1, IMAGE_MAX / Math.max(meta.width, meta.height));
      const opts: ImageBitmapOptions =
        s < 1 ? { resizeWidth: Math.round(meta.width * s), resizeHeight: Math.round(meta.height * s), resizeQuality: 'high' } : {};
      createImageBitmap(blob, opts).then(
        (b) => {
          this.images.set(assetId, b);
          this.invalidate();
        },
        () => this.images.set(assetId, 'error'),
      );
    }
    return null;
  }

  private draw(edit: EditState, frame: number): void {
    const { width: W } = RATIO_SIZE[edit.ratio];
    const k = this.canvas.width / W;
    this.ctx.setTransform(k, 0, 0, k, 0, 0);
    let ready = true;
    const f = Math.floor(frame);
    // 효과(필터·흐림 배경)가 있을 때만 WebGL 처리기를 쓴다. 내보내기 Worker도 같은 처리기를 만든다.
    const effects = needsEffects(edit) ? sharedEffects() : null;
    const sources: FrameSources = {
      effects,
      effectScale: k,
      text: (c, clip) => {
        // 글꼴이 아직 안 올라왔으면 그리지 않고, 올라오면 다시 그린다 (다른 글꼴로 잘못 보이지 않게)
        if (!this.ensureTextFont(clip.font, clip.weight)) {
          ready = false;
          return;
        }
        drawTextClip(c, clip, RATIO_SIZE[edit.ratio].width, RATIO_SIZE[edit.ratio].height, frame);
      },
      visual: (clip) => {
        if (clip.type === 'image') {
          const b = this.image(clip.assetId);
          if (!b) ready = false;
          return b ? { image: b, width: b.width, height: b.height } : null;
        }
        const s = this.slots.get(clip.id);
        if (!s || s.el.readyState < 2) {
          ready = false;
          return null;
        }
        if (!this.playing && !s.settled) ready = false;
        const v = s.el as HTMLVideoElement;
        return { image: v, width: v.videoWidth, height: v.videoHeight };
      },
    };
    drawFrame(this.ctx, edit, f, sources);
    this.dirty = false;
    this.renderedFrame = f;
    this.ready = ready;
    const t = performance.now();
    this.draws.push(t);
    while (this.draws.length && this.draws[0] < t - 1000) this.draws.shift();
    while (this.drifts.length && this.drifts[0].t < t - 2000) this.drifts.shift();
  }

  /** 클립의 소스 크기. 아직 준비되지 않았거나 화면에 안 나오는 종류면 null */
  sourceSize(clip: Clip): { width: number; height: number } | null {
    if (clip.type === 'image') {
      const b = this.images.get(clip.assetId);
      return b instanceof ImageBitmap ? { width: b.width, height: b.height } : null;
    }
    if (clip.type === 'video') {
      const v = this.slots.get(clip.id)?.el as HTMLVideoElement | undefined;
      return v && v.videoWidth > 0 ? { width: v.videoWidth, height: v.videoHeight } : null;
    }
    return null; // audio: 화면 없음 / text: 크기는 layoutText로 따로 구한다
  }

  /** 지금 플레이헤드에서 이 클립이 놓인 사각형 (화면에 없으면 null) */
  boxOf(clipId: string): Box | null {
    const edit = useProject.getState().edit;
    const frame = useUI.getState().playhead;
    const loc = findClip(edit, clipId);
    if (!loc || loc.track.kind === 'audio') return null;
    const c = loc.clip;
    if (frame < c.start || frame >= c.start + c.duration) return null;
    const { width: W, height: H } = RATIO_SIZE[edit.ratio];
    if (c.type === 'text') {
      // 텍스트는 글자 배치 결과가 곧 크기다 (맞춤 계산을 하지 않는다)
      const l = layoutText(c, W, H);
      return textBox(l.width, l.height, transformAt(c, frame), W, H);
    }
    const size = this.sourceSize(c);
    if (!size) return null;
    return clipBox(size.width, size.height, transformAt(c, frame), W, H);
  }

  /** 프로젝트 좌표의 점에 있는 가장 위 클립 id (없으면 null). 텍스트 → 위쪽 영상 트랙 순서로 본다 */
  hitTest(p: Point): string | null {
    const edit = useProject.getState().edit;
    const frame = useUI.getState().playhead;
    const visual = edit.tracks.filter((t) => t.kind === 'text' || t.kind === 'video');
    for (const track of visual) {
      const c = clipAt(track, frame);
      if (!c) continue;
      const box = this.boxOf(c.id);
      if (box && containsPoint(p, box)) return c.id;
    }
    return null;
  }

  /** 이 클립 미디어 요소의 재생 속도·음 높이 유지 (테스트용) */
  mediaState(clipId: string): { rate: number; preservesPitch: boolean; paused: boolean } | null {
    const el = this.slots.get(clipId)?.el;
    return el ? { rate: el.playbackRate, preservesPitch: el.preservesPitch, paused: el.paused } : null;
  }

  /**
   * 이 클립에 지금 걸려 있는 소리 크기(GainNode 값). 없으면 null.
   * 미리보기가 정말 gainAt 곡선을 쓰는지 테스트로 확인하는 데 쓴다 (R8.4).
   */
  clipGain(clipId: string): number | null {
    const g = this.slots.get(clipId)?.audio?.gain;
    return g ? g.gain.value : null;
  }

  stats(): PreviewStats {
    let maxGap = 0;
    for (let i = 1; i < this.draws.length; i++) maxGap = Math.max(maxGap, this.draws[i] - this.draws[i - 1]);
    return {
      playing: this.playing,
      starting: this.starting,
      renderedFrame: this.renderedFrame,
      // 편집/탐색으로 다시 그려야 하는데 아직 안 그렸으면 준비 안 됨 (지난 그림은 이전 상태)
      ready: this.ready && !this.dirty,
      slots: this.slots.size,
      audioState: this.audio?.ctx.state ?? 'none',
      level: this.audio?.level() ?? 0,
      maxDrift: this.drifts.reduce((m, d) => Math.max(m, d.d), 0),
      drawFps: this.draws.length,
      maxGapMs: Math.round(maxGap),
    };
  }
}

/** 현재 미리보기 엔진 (테스트 창구에서 읽는다) */
export const previewRef: { current: PreviewEngine | null } = { current: null };
