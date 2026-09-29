/**
 * 검증용: 같은 원본 프레임을 미리보기와 내보내기가 쓰는 두 디코딩 길로 풀어 비교한다.
 *  A) <video> 요소 → drawImage (미리보기)
 *  B) Mediabunny CanvasSink + matchPreviewColor (내보내기 Worker와 같은 설정)
 * 합성·필터와 상관없이 "원본을 푸는 단계"의 색이 같은지 본다 (tests/e2e/color.spec.ts).
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { matchPreviewColor } from '../media/color';

export type DecodePaths = {
  w: number;
  h: number;
  /** 원본 트랙에 적힌 색 정보 */
  colorSpace: VideoColorSpaceInit;
  /** 내보내기 디코더에 바꿔 넣은 색 공간 (그대로 뒀으면 null) */
  applied: VideoColorSpaceInit | null;
  /** 두 길의 RGB 평균 절대 차이 (0~255) */
  meanAbs: number;
  /** raw 옵션일 때: 두 길의 RGB 원시값 (W×H×3, base64) — ffmpeg 결과와 비교하는 진단용 */
  video?: string;
  sink?: string;
};

function rgb(d: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array((d.length / 4) * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
    out[j] = d[i];
    out[j + 1] = d[i + 1];
    out[j + 2] = d[i + 2];
  }
  return out;
}

function b64(a: Uint8Array): string {
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function decodePaths(blob: Blob, frame: number, opts: { fps?: number; raw?: boolean } = {}): Promise<DecodePaths> {
  const t = frame / (opts.fps ?? 30) + 0.001;
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const url = URL.createObjectURL(blob.slice(0, blob.size, 'video/mp4'));
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    const W = await track.getDisplayWidth();
    const H = await track.getDisplayHeight();
    const colorSpace = await track.getColorSpace();
    const applied = await matchPreviewColor(track);

    const grab = (src: CanvasImageSource) => {
      const c = new OffscreenCanvas(W, H);
      const x = c.getContext('2d')!;
      x.imageSmoothingEnabled = false;
      x.drawImage(src, 0, 0, W, H);
      return rgb(x.getImageData(0, 0, W, H).data);
    };

    const v = document.createElement('video');
    v.muted = true;
    v.src = url;
    await new Promise((res, rej) => ((v.onloadeddata = res), (v.onerror = rej)));
    // 'seeked' 직후에는 새 프레임이 아직 화면에 올라오지 않았을 수 있다(CPU가 바쁠 때). 올라올 때까지 기다린다
    const presented = new Promise<void>((res) => {
      const done = setTimeout(res, 1000);
      v.requestVideoFrameCallback(() => {
        clearTimeout(done);
        res();
      });
    });
    const seeked = new Promise((res) => (v.onseeked = res));
    v.currentTime = t;
    await seeked;
    await presented;
    const a = grab(v);

    const wc = await new CanvasSink(track, { poolSize: 1 }).getCanvas(t);
    if (!wc) throw new Error('no frame');
    const b = grab(wc.canvas);

    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return {
      w: W,
      h: H,
      colorSpace,
      applied,
      meanAbs: sum / a.length,
      ...(opts.raw ? { video: b64(a), sink: b64(b) } : {}),
    };
  } finally {
    input.dispose();
    URL.revokeObjectURL(url);
  }
}
