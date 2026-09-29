/**
 * WebGL2 효과 처리기 — 필터·색 조정(R15), 흐림 배경(R18). 트랜지션·영상 효과도 여기에 붙는다.
 *
 * - 미리보기(메인 스레드)와 내보내기(Worker)가 **같은 코드**를 쓴다 (R0.3, R11.8).
 * - 입력은 먼저 2D 캔버스에 필요한 크기로 그린 뒤 올린다. 이렇게 하면
 *   ① 휴대폰 영상의 회전 정보가 기존 2D 경로와 똑같이 적용되고
 *   ② 큰 원본을 줄일 때 계단 현상이 생기지 않으며
 *   ③ 셰이더는 필요한 픽셀 수만 처리한다.
 * - 결과는 이 처리기 캔버스의 왼쪽 위에 그려진다. 합성기는 다음 호출이 같은 캔버스를 덮어쓰기 전에
 *   곧바로 그 부분을 drawImage로 가져간다.
 * - `adjustPixel`(src/model/filters.ts)이 FS_FILTER와 같은 계산을 한다. 둘 중 하나를 고치면 다른 쪽도 고친다.
 */
import type { ColorAdjust } from '../../model/types';
import type { EffectImage, Effects } from '../compose';

type GL = WebGL2RenderingContext;

const MAX_SIZE = 4096;
/** 흐림 배경은 프로젝트 해상도의 1/8에서 흐리게 한다 → 미리보기·내보내기에서 같은 결과, 큰 흐림도 가볍다 */
const BLUR_DOWNSCALE = 8;
/** 흐림 정도 100일 때 표준편차(작은 그림 픽셀) */
const BLUR_MAX_SIGMA = 10;

const VS = `#version 300 es
in vec2 a_pos;
uniform float u_flipY;
out vec2 v_uv;
void main() {
  // 텍스처는 모두 "0행 = 그림 위쪽"으로 둔다. 화면(캔버스)에 그릴 때만 위아래를 뒤집어 똑바로 보이게 한다
  v_uv = vec2((a_pos.x + 1.0) * 0.5, u_flipY > 0.5 ? (1.0 - a_pos.y) * 0.5 : (a_pos.y + 1.0) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FS_FILTER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_sharpPx;
uniform vec4 u_adj;   // 밝기, 대비, 채도, 색온도 (-1~1)
uniform float u_sharp; // 0~1
uniform float u_vig;   // 0~1
out vec4 outColor;
void main() {
  vec4 src = texture(u_tex, v_uv);
  vec3 c = src.rgb;
  if (u_sharp > 0.0) {
    vec2 o = u_texel * u_sharpPx;
    vec3 n = texture(u_tex, v_uv + vec2(o.x, 0.0)).rgb + texture(u_tex, v_uv - vec2(o.x, 0.0)).rgb
           + texture(u_tex, v_uv + vec2(0.0, o.y)).rgb + texture(u_tex, v_uv - vec2(0.0, o.y)).rgb;
    c = c + (c - n * 0.25) * (u_sharp * 1.5);
  }
  c += u_adj.x * 0.3;
  c = (c - 0.5) * (1.0 + u_adj.y) + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = l + (c - l) * (1.0 + u_adj.z);
  c += vec3(0.1, 0.02, -0.1) * u_adj.w;
  c = clamp(c, 0.0, 1.0);
  if (u_vig > 0.0) {
    float d = distance(v_uv, vec2(0.5)) * 1.41421356;
    c *= 1.0 - u_vig * 0.85 * smoothstep(0.35, 1.0, d);
  }
  outColor = vec4(c * src.a, src.a);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_step;
uniform float u_sigma;
out vec4 outColor;
void main() {
  float s = max(u_sigma, 0.001);
  int r = int(min(ceil(s * 3.0), 32.0));
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -32; i <= 32; i++) {
    if (i < -r || i > r) continue;
    float w = exp(-float(i * i) / (2.0 * s * s));
    acc += texture(u_tex, v_uv + u_step * float(i)) * w;
    wsum += w;
  }
  outColor = acc / wsum;
}`;

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

type Ctx2 = OffscreenCanvasRenderingContext2D;

/** 그림의 실제 픽셀 크기 (영상은 회전 정보가 반영된 크기) */
function dims(img: CanvasImageSource): [number, number] {
  if (typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement) return [img.videoWidth, img.videoHeight];
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return [img.naturalWidth, img.naturalHeight];
  const s = img as { width: number; height: number };
  return [s.width, s.height];
}

const clampSize = (v: number) => Math.max(1, Math.min(MAX_SIZE, Math.round(v)));

function fitSize(w: number, h: number): [number, number] {
  const k = Math.min(1, MAX_SIZE / Math.max(w, h));
  return [clampSize(w * k), clampSize(h * k)];
}

export class GLEffects implements Effects {
  private canvas: OffscreenCanvas;
  private gl: GL;
  private filterProg: Program;
  private blurProg: Program;
  private vao: WebGLVertexArrayObject;
  private srcTex: WebGLTexture;
  private targets = new Map<string, Target>();
  private scratch = new OffscreenCanvas(1, 1);
  private scratchCtx: Ctx2;
  private lost = false;

  constructor() {
    this.canvas = new OffscreenCanvas(256, 256);
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.filterProg = this.program(FS_FILTER, ['u_tex', 'u_texel', 'u_sharpPx', 'u_adj', 'u_sharp', 'u_vig', 'u_flipY']);
    this.blurProg = this.program(FS_BLUR, ['u_tex', 'u_step', 'u_sigma', 'u_flipY']);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.srcTex = this.texture();
    this.scratchCtx = this.scratch.getContext('2d')!;
  }

  get usable(): boolean {
    return !this.lost && !this.gl.isContextLost();
  }

  private program(fs: string, uniforms: string[]): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`셰이더 오류: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`셰이더 연결 오류: ${gl.getProgramInfoLog(prog)}`);
    const u: Program['u'] = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
    return { prog, u };
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** 중간 결과용 텍스처+프레임버퍼 (크기가 바뀔 때만 새로 만든다) */
  private target(name: string, w: number, h: number): Target {
    const gl = this.gl;
    let t = this.targets.get(name);
    if (t && t.w === w && t.h === h) return t;
    if (t) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
    }
    const tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    t = { tex, fb, w, h };
    this.targets.set(name, t);
    return t;
  }

  /** 그림을 2D로 w×h에 그려(자르기 가능) 텍스처로 올린다 */
  private upload(img: CanvasImageSource, w: number, h: number, crop?: [number, number, number, number]): void {
    const c = this.scratch;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = this.scratchCtx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);
    if (crop) ctx.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, w, h);
    else ctx.drawImage(img, 0, 0, w, h);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  }

  /** 결과를 캔버스 왼쪽 위 w×h에 그릴 준비 (캔버스는 커지기만 한다) */
  private toCanvas(w: number, h: number): void {
    const gl = this.gl;
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w);
      this.canvas.height = Math.max(this.canvas.height, h);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, this.canvas.height - h, w, h);
  }

  private toTarget(t: Target): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, t.w, t.h);
  }

  private drawFilter(tex: WebGLTexture, texW: number, texH: number, a: ColorAdjust, sharpPx: number, flip: boolean, withSharpVig: boolean): void {
    const gl = this.gl;
    const p = this.filterProg;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(p.u.u_tex, 0);
    gl.uniform2f(p.u.u_texel, 1 / texW, 1 / texH);
    gl.uniform1f(p.u.u_sharpPx, sharpPx);
    gl.uniform4f(p.u.u_adj, a.brightness / 100, a.contrast / 100, a.saturation / 100, a.temperature / 100);
    gl.uniform1f(p.u.u_sharp, withSharpVig ? a.sharpness / 100 : 0);
    gl.uniform1f(p.u.u_vig, withSharpVig ? a.vignette / 100 : 0);
    gl.uniform1f(p.u.u_flipY, flip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawBlur(tex: WebGLTexture, texW: number, texH: number, dx: number, dy: number, sigma: number, flip: boolean): void {
    const gl = this.gl;
    const p = this.blurProg;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(p.u.u_tex, 0);
    gl.uniform2f(p.u.u_step, dx / texW, dy / texH);
    gl.uniform1f(p.u.u_sigma, sigma);
    gl.uniform1f(p.u.u_flipY, flip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  filter(image: CanvasImageSource, adjust: ColorAdjust, outW: number, outH: number, pxScale: number): EffectImage | null {
    if (!this.usable) return null;
    const [w, h] = fitSize(outW, outH);
    this.upload(image, w, h);
    this.toCanvas(w, h);
    // 선명도 반경 = 프로젝트 1픽셀 → 결과 그림에서는 pxScale픽셀 (작은 미리보기에서는 1픽셀보다 작아 약하게 보인다)
    this.drawFilter(this.srcTex, w, h, adjust, pxScale * (w / Math.max(1, outW)), true, true);
    return { image: this.canvas, sx: 0, sy: 0, sw: w, sh: h };
  }

  blurFill(image: CanvasImageSource, adjust: ColorAdjust | null, W: number, H: number, amount: number): EffectImage | null {
    if (!this.usable) return null;
    const [iw, ih] = dims(image);
    if (!iw || !ih) return null;
    const sw = Math.max(8, Math.round(W / BLUR_DOWNSCALE));
    const sh = Math.max(8, Math.round(H / BLUR_DOWNSCALE));
    // 캔버스를 꽉 채우도록(cover) 가운데를 잘라 작게 그린다
    const scale = Math.max(W / iw, H / ih);
    const cw = W / scale;
    const ch = H / scale;
    this.upload(image, sw, sh, [(iw - cw) / 2, (ih - ch) / 2, cw, ch]);
    let input = this.srcTex;
    if (adjust) {
      const a = this.target('A', sw, sh);
      this.toTarget(a);
      this.drawFilter(this.srcTex, sw, sh, adjust, 1, false, false);
      input = a.tex;
    }
    const sigma = (Math.max(0, Math.min(100, amount)) / 100) * BLUR_MAX_SIGMA;
    const b = this.target('B', sw, sh);
    this.toTarget(b);
    this.drawBlur(input, sw, sh, 1, 0, sigma, false);
    this.toCanvas(sw, sh);
    this.drawBlur(b.tex, sw, sh, 0, 1, sigma, true);
    return { image: this.canvas, sx: 0, sy: 0, sw, sh };
  }
}

/** 새 효과 처리기. WebGL2를 쓸 수 없으면 null */
export function createEffects(): GLEffects | null {
  try {
    return new GLEffects();
  } catch (e) {
    console.warn('[effects] WebGL2 효과를 쓸 수 없습니다', e);
    return null;
  }
}

let shared: GLEffects | null | undefined;
/** 메인 스레드에서 같이 쓰는 처리기 (미리보기, 필터 목록 썸네일). 잃어버리면 다시 만든다 */
export function sharedEffects(): GLEffects | null {
  if (shared && !shared.usable) shared = undefined;
  if (shared === undefined) shared = createEffects();
  return shared;
}

let supported: boolean | undefined;
/** 이 브라우저에서 WebGL2 효과를 쓸 수 있는지 (한 번만 확인) */
export function effectsSupported(): boolean {
  if (supported === undefined) supported = sharedEffects() !== null;
  return supported;
}
