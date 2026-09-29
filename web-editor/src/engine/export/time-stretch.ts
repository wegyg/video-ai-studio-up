/**
 * 음 높이를 유지한 채 속도 바꾸기 (R17, 내보내기용). WSOLA(파형이 가장 잘 이어지는 곳을 찾아 겹쳐 붙이기).
 *
 * 미리보기는 브라우저의 `HTMLMediaElement.preservesPitch`(Chrome도 내부에서 WSOLA 방식)를 쓰고,
 * 내보내기는 Worker·Web Audio에 같은 기능이 없어 여기서 직접 한다. 외부 라이브러리를 쓰지 않는다(라이선스).
 * - 창 40ms(Hann), 50% 겹침. 출력 한 칸마다 원본에서 "앞 조각의 자연스러운 다음 부분"과 가장 닮은 위치를
 *   ±10ms 안에서 찾아 붙인다 → 이음매에서 파형이 끊기지 않는다.
 * - 위치는 모든 채널의 합으로 한 번 찾고 모든 채널에 똑같이 쓴다 (좌우 소리가 어긋나지 않게).
 */

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** mono[a..a+len)와 mono[b..b+len)의 닮은 정도 (b 쪽 크기로 나눔). step으로 표본을 건너뛰어 빠르게 */
function similarity(mono: Float32Array, a: number, b: number, len: number, step: number): number {
  let dot = 0;
  let eng = 1e-9;
  const n = mono.length;
  for (let i = 0; i < len; i += step) {
    const ia = a + i;
    const ib = b + i;
    const x = ia >= 0 && ia < n ? mono[ia] : 0;
    const y = ib >= 0 && ib < n ? mono[ib] : 0;
    dot += x * y;
    eng += y * y;
  }
  return dot / Math.sqrt(eng);
}

/**
 * @param channels 채널별 원본 표본
 * @param speed 2 = 두 배 빠르게(길이 절반), 0.5 = 절반 속도(길이 두 배)
 * @returns 채널별 결과 (길이 ≈ 원본 / speed)
 */
export function timeStretch(channels: Float32Array[], speed: number, sampleRate: number): Float32Array<ArrayBuffer>[] {
  const inLen = channels[0]?.length ?? 0;
  const outLen = Math.max(1, Math.round(inLen / speed));
  if (Math.abs(speed - 1) < 1e-6 || inLen === 0) return channels.map((c) => c.slice(0, outLen));

  const N = Math.max(64, Math.round(sampleRate * 0.04) & ~1);
  const Hs = N / 2;
  const Ha = Hs * speed;
  const tol = Math.round(sampleRate * 0.01);
  const win = hann(N);

  const mono = new Float32Array(inLen);
  for (const c of channels) for (let i = 0; i < inLen; i++) mono[i] += c[i];

  const outs = channels.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  let prev = 0;
  for (let k = 0; k * Hs < outLen; k++) {
    const nominal = Math.round(k * Ha);
    let pos = nominal;
    if (k > 0) {
      // 앞 조각이 원래 이어졌을 부분(prev + Hs)과 가장 닮은 곳을 nominal 둘레에서 찾는다 (거칠게 → 촘촘히)
      const target = prev + Hs;
      let best = -Infinity;
      for (let d = -tol; d <= tol; d += 8) {
        const s = similarity(mono, target, nominal + d, Hs, 4);
        if (s > best) {
          best = s;
          pos = nominal + d;
        }
      }
      const coarse = pos;
      best = -Infinity;
      for (let d = -8; d <= 8; d++) {
        const s = similarity(mono, target, coarse + d, Hs, 1);
        if (s > best) {
          best = s;
          pos = coarse + d;
        }
      }
    }
    const o = k * Hs;
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch];
      const dst = outs[ch];
      for (let i = 0; i < N; i++) {
        const j = pos + i;
        if (j >= 0 && j < inLen) dst[o + i] += src[j] * win[i];
      }
    }
    for (let i = 0; i < N; i++) norm[o + i] += win[i];
    prev = pos;
  }
  return outs.map((buf) => {
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) res[i] = norm[i] > 1e-3 ? buf[i] / norm[i] : 0;
    return res;
  });
}
