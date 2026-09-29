/**
 * WebGL2 효과 처리기 — 필터·색 조정(R15), 흐림 배경(R18), 트랜지션(R14). 영상 효과도 여기에 붙는다.
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
import type { EffectParams } from '../../model/effects';
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
uniform vec4 u_fx1;    // 영상 효과 강도(0~1): 흔들림, 번쩍임, 줌 펄스, 흑백
uniform vec3 u_fx2;    // 레트로, 블러 강도, 클립 시작부터의 시간(초)
out vec4 outColor;

// 블러: 반경은 프로젝트 기준 픽셀(강도 100% = 40px) → 미리보기·내보내기 해상도가 달라도 같은 모습.
// 7×7 표본 사이 간격만큼 미리 평균 낸 밉맵 단계에서 읽어, 반경이 커도 겹쳐 보이는 자국이 없다
vec4 tap(vec2 uv) {
  if (u_fx2.y <= 0.0) return texture(u_tex, uv);
  float rpx = u_sharpPx * u_fx2.y * 40.0;
  vec2 r = u_texel * rpx;
  float lod = log2(max(rpx / 3.0, 1.0));
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
    vec2 o = vec2(float(i), float(j)) / 3.0;
    float w = exp(-dot(o, o) * 2.0);
    acc += textureLod(u_tex, uv + o * r, lod) * w;
    ws += w;
  }
  return acc / ws;
}

void main() {
  float t = u_fx2.z;
  vec2 uv = v_uv;
  // 줌 펄스: 0.5초마다 커졌다 돌아온다 (최대 +12%)
  float pulse = u_fx1.z * 0.12 * pow(max(0.0, sin(6.2831853 * t * 2.0)), 2.0);
  // 흔들림: 여러 사인을 섞은 불규칙한 흔들림. 가장자리가 보이지 않게 조금 확대한다
  vec2 sh = u_fx1.x * 0.03 * vec2(sin(t * 37.0) + 0.5 * sin(t * 71.0 + 1.3), cos(t * 43.0) + 0.5 * sin(t * 59.0 + 0.7));
  float z = (1.0 + pulse) * (1.0 + u_fx1.x * 0.12);
  uv = (uv - 0.5) / z + 0.5 + sh / z;

  vec4 src = tap(uv);
  vec3 c = src.rgb;
  if (u_fx2.x > 0.0) {
    // 레트로: 빨강·파랑이 살짝 어긋난다
    float d = 0.004 * u_fx2.x;
    c.r = mix(c.r, tap(uv + vec2(d, 0.0)).r, 1.0);
    c.b = mix(c.b, tap(uv - vec2(d, 0.0)).b, 1.0);
  }
  if (u_sharp > 0.0) {
    vec2 o = u_texel * u_sharpPx;
    vec3 n = texture(u_tex, uv + vec2(o.x, 0.0)).rgb + texture(u_tex, uv - vec2(o.x, 0.0)).rgb
           + texture(u_tex, uv + vec2(0.0, o.y)).rgb + texture(u_tex, uv - vec2(0.0, o.y)).rgb;
    c = c + (c - n * 0.25) * (u_sharp * 1.5);
  }
  c += u_adj.x * 0.3;
  c = (c - 0.5) * (1.0 + u_adj.y) + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = l + (c - l) * (1.0 + u_adj.z);
  c += vec3(0.1, 0.02, -0.1) * u_adj.w;
  c = clamp(c, 0.0, 1.0);
  // 흑백
  c = mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), u_fx1.w);
  // 레트로: 누렇게 바랜 색
  if (u_fx2.x > 0.0) {
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 sepia = clamp(vec3(g * 1.07 + 0.06, g * 0.93 + 0.03, g * 0.72), 0.0, 1.0);
    c = mix(c, mix(c, sepia, 0.65) * 0.88 + 0.06, u_fx2.x);
  }
  // 번쩍임: 시작하자마자, 그리고 약 0.67초마다 하얗게 번쩍
  float fl = u_fx1.y * pow(max(0.0, cos(6.2831853 * t * 1.5)), 12.0);
  c = mix(c, vec3(1.0), fl * 0.85);
  if (u_vig > 0.0) {
    float dv = distance(v_uv, vec2(0.5)) * 1.41421356;
    c *= 1.0 - u_vig * 0.85 * smoothstep(0.35, 1.0, dv);
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

/**
 * 트랜지션 11종 (R14). u_a = 앞 화면, u_b = 새 화면 (둘 다 알파가 곱해진 텍스처, 0행 = 위쪽).
 * u_kind 번호는 model/transitions.ts의 TRANSITION_KINDS 순서와 같다.
 * 무작위처럼 보이는 값(글리치)은 정수 해시로 만든다 → 미리보기와 내보내기(다른 GL 컨텍스트)가 같은 결과.
 */
const FS_TRANSITION = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_p;
uniform int u_kind;
uniform float u_aspect; // 가로/세로 — 흐림·흔들림을 동그랗게
out vec4 outColor;

bool inside(vec2 uv) { return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0; }
vec4 A(vec2 uv) { return inside(uv) ? texture(u_a, uv) : vec4(0.0); }
vec4 B(vec2 uv) { return inside(uv) ? texture(u_b, uv) : vec4(0.0); }
float ease(float t) { return t * t * (3.0 - 2.0 * t); }
vec2 zoom(vec2 uv, float s) { return (uv - 0.5) / s + 0.5; }
float hash(uint x, uint y) {
  uint h = x * 747796405u + y * 2891336453u + 12345u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h & 0xffffffu) / 16777215.0;
}
vec4 blurA(vec2 uv, float r) {
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 o = vec2(float(i), float(j)) * 0.5;
    float w = exp(-dot(o, o) * 1.5);
    acc += texture(u_a, uv + o * vec2(r, r * u_aspect)) * w; ws += w;
  }
  return acc / ws;
}
vec4 blurB(vec2 uv, float r) {
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 o = vec2(float(i), float(j)) * 0.5;
    float w = exp(-dot(o, o) * 1.5);
    acc += texture(u_b, uv + o * vec2(r, r * u_aspect)) * w; ws += w;
  }
  return acc / ws;
}

void main() {
  vec2 uv = v_uv;
  float p = clamp(u_p, 0.0, 1.0);
  float e = ease(p);
  const float PI = 3.14159265;
  vec4 c;
  if (u_kind == 0) {            // 디졸브
    c = mix(texture(u_a, uv), texture(u_b, uv), p);
  } else if (u_kind == 1) {     // 슬라이드 ←: 앞 화면이 왼쪽으로 나가고 새 화면이 오른쪽에서 들어온다
    c = A(uv + vec2(e, 0.0)) + B(uv + vec2(e - 1.0, 0.0));
  } else if (u_kind == 2) {     // 슬라이드 →
    c = A(uv - vec2(e, 0.0)) + B(uv - vec2(e - 1.0, 0.0));
  } else if (u_kind == 3) {     // 슬라이드 ↑
    c = A(uv + vec2(0.0, e)) + B(uv + vec2(0.0, e - 1.0));
  } else if (u_kind == 4) {     // 슬라이드 ↓
    c = A(uv - vec2(0.0, e)) + B(uv - vec2(0.0, e - 1.0));
  } else if (u_kind == 5) {     // 줌 인: 새 화면이 가운데에서 커지며 덮는다 (앞 화면도 살짝 다가온다)
    vec4 a = texture(u_a, zoom(uv, 1.0 + 0.25 * e));
    vec4 b = B(zoom(uv, max(e, 0.001))) * smoothstep(0.0, 0.25, p);
    c = b + a * (1.0 - b.a);
  } else if (u_kind == 6) {     // 줌 아웃: 앞 화면이 가운데로 작아지며 빠지고 새 화면이 드러난다
    vec4 b = texture(u_b, zoom(uv, 1.15 - 0.15 * e));
    vec4 a = A(zoom(uv, max(1.0 - e, 0.001))) * (1.0 - smoothstep(0.75, 1.0, p));
    c = a + b * (1.0 - a.a);
  } else if (u_kind == 7) {     // 와이프: 왼쪽부터 새 화면으로 닦아 낸다
    float w = 0.03;
    float edge = e * (1.0 + 2.0 * w) - w;
    c = mix(texture(u_b, uv), texture(u_a, uv), smoothstep(edge - w, edge + w, uv.x));
  } else if (u_kind == 8) {     // 블러: 앞 화면이 흐려지고, 흐린 새 화면이 또렷해진다
    float r = 0.05 * sin(PI * p);
    float q = smoothstep(0.35, 0.65, p);
    if (q <= 0.0) c = blurA(uv, r);
    else if (q >= 1.0) c = blurB(uv, r);
    else c = mix(blurA(uv, r), blurB(uv, r), q);
  } else if (u_kind == 9) {     // 흔들림: 화면이 흔들리는 사이에 바뀐다
    float amp = sin(PI * p);
    vec2 o = amp * vec2(0.035 * sin(p * 71.0), 0.035 * u_aspect * cos(p * 53.0));
    vec2 s = zoom(uv, 1.0 + 0.12 * amp) + o;
    c = mix(texture(u_a, s), texture(u_b, s), smoothstep(0.45, 0.55, p));
  } else {                      // 글리치: 가로줄이 어긋나고 색이 갈라지며 바뀐다
    float g = sin(PI * p);
    uint row = uint(floor(uv.y * 28.0));
    uint stp = uint(floor(p * 14.0));
    float dx = (hash(row, stp) - 0.5) * 0.2 * g * (hash(row + 97u, stp) > 0.45 ? 1.0 : 0.0);
    vec2 s = uv + vec2(dx, 0.0);
    float split = 0.012 * g;
    bool useB = p + (hash(row, stp + 31u) - 0.5) * 0.5 * g >= 0.5;
    vec4 r = useB ? texture(u_b, s + vec2(split, 0.0)) : texture(u_a, s + vec2(split, 0.0));
    vec4 m = useB ? texture(u_b, s) : texture(u_a, s);
    vec4 b = useB ? texture(u_b, s - vec2(split, 0.0)) : texture(u_a, s - vec2(split, 0.0));
    c = vec4(r.r, m.g, b.b, m.a);
  }
  outColor = vec4(min(c.rgb, vec3(c.a)), c.a);
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
  private transProg: Program;
  private vao: WebGLVertexArrayObject;
  private srcTex: WebGLTexture;
  private srcTex2: WebGLTexture;
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
    this.filterProg = this.program(FS_FILTER, ['u_tex', 'u_texel', 'u_sharpPx', 'u_adj', 'u_sharp', 'u_vig', 'u_fx1', 'u_fx2', 'u_flipY']);
    this.blurProg = this.program(FS_BLUR, ['u_tex', 'u_step', 'u_sigma', 'u_flipY']);
    this.transProg = this.program(FS_TRANSITION, ['u_a', 'u_b', 'u_p', 'u_kind', 'u_aspect', 'u_flipY']);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.srcTex = this.texture();
    this.srcTex2 = this.texture();
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // 밉맵 없이 (블러 필터만 켠다)
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

  private drawFilter(tex: WebGLTexture, texW: number, texH: number, a: ColorAdjust, sharpPx: number, flip: boolean, withSharpVig: boolean, fx: EffectParams | null = null): void {
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
    gl.uniform4f(p.u.u_fx1, fx?.shake ?? 0, fx?.flash ?? 0, fx?.zoom ?? 0, fx?.mono ?? 0);
    gl.uniform3f(p.u.u_fx2, fx?.retro ?? 0, fx?.blur ?? 0, fx?.t ?? 0);
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

  filter(image: CanvasImageSource, adjust: ColorAdjust, outW: number, outH: number, pxScale: number, fx: EffectParams | null = null): EffectImage | null {
    if (!this.usable) return null;
    const [w, h] = fitSize(outW, outH);
    this.upload(image, w, h);
    if (fx && fx.blur > 0) {
      // 블러 효과: 밉맵으로 넓은 반경을 가볍게 (위 FS_FILTER의 tap)
      const gl = this.gl;
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    this.toCanvas(w, h);
    // 선명도 반경 = 프로젝트 1픽셀 → 결과 그림에서는 pxScale픽셀 (작은 미리보기에서는 1픽셀보다 작아 약하게 보인다)
    this.drawFilter(this.srcTex, w, h, adjust, pxScale * (w / Math.max(1, outW)), true, true, fx);
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

  /**
   * 트랜지션 (R14): 같은 크기(w×h)의 두 장면 a(앞)·b(새)를 progress(0~1)만큼 섞는다.
   * 두 장면은 합성기가 클립 배치·필터까지 그려 둔 캔버스라 그대로 올린다 (알파를 곱한 채로 → 가장자리에 검은 테가 생기지 않는다).
   */
  transition(a: CanvasImageSource, b: CanvasImageSource, kind: number, progress: number, w: number, h: number): EffectImage | null {
    if (!this.usable) return null;
    const gl = this.gl;
    const [tw, th] = fitSize(w, h);
    const put = (unit: number, tex: WebGLTexture, img: CanvasImageSource) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img as TexImageSource);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    };
    put(0, this.srcTex, a);
    put(1, this.srcTex2, b);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.toCanvas(tw, th);
    const p = this.transProg;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.uniform1i(p.u.u_a, 0);
    gl.uniform1i(p.u.u_b, 1);
    gl.uniform1f(p.u.u_p, progress);
    gl.uniform1i(p.u.u_kind, kind);
    gl.uniform1f(p.u.u_aspect, w / Math.max(1, h));
    gl.uniform1f(p.u.u_flipY, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    return { image: this.canvas, sx: 0, sy: 0, sw: tw, sh: th };
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
