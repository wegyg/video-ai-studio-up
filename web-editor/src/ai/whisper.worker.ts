/**
 * Whisper 음성 인식 Worker (R20, R0.1~R0.2).
 *
 * - 브라우저 안에서만 돌린다. 외부 API·API 키를 쓰지 않는다. 모델은 Hugging Face에서 한 번 받아
 *   브라우저 캐시(Cache API)에 저장되므로 두 번째부터는 바로 시작한다.
 * - WebGPU가 있으면 WebGPU, 없으면 WASM으로 되돌아간다. 편집을 막지 않도록 Worker에서 돈다.
 * - 단어별 타이밍은 `_timestamped` 모델 + `return_timestamps: 'word'`로 받는다
 *   (@huggingface/transformers 4.3 타입 정의에서 확인).
 */
import { env, pipeline } from '@huggingface/transformers';
import type { AsrWord } from '../model/captions';
import type { TranscribeRequest, WhisperDevice, WhisperMessage } from './whisper-protocol';

const port = self as unknown as { postMessage(m: WhisperMessage): void; onmessage: ((e: MessageEvent<TranscribeRequest>) => void) | null };

env.allowLocalModels = false; // 우리 서버에는 모델이 없다 (Hugging Face에서 받아 캐시)

/** 장치별로 시도할 양자화 순서. 저장소에 없는 형식은 오류가 나므로 다음 것으로 넘어간다 */
const DTYPES: Record<WhisperDevice, string[]> = {
  webgpu: ['q4f16', 'fp16', 'q8'],
  wasm: ['q8', 'int8', 'q4'],
};

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string; chunks?: { text?: string; timestamp?: [number, number] }[] }>;

/** 쓸 수 있는 장치: WebGPU 어댑터가 실제로 잡히면 WebGPU, 아니면 CPU(WASM) */
async function pickDevice(): Promise<WhisperDevice> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) return 'webgpu';
  } catch {
    /* WebGPU를 못 쓰는 환경 */
  }
  return 'wasm';
}

/**
 * 모델 준비. 장치·양자화 조합을 순서대로 시도한다 (저장소에 없는 형식이나 막힌 WebGPU는 오류가 난다).
 * @returns 실제로 성공한 장치와 인식기
 */
async function load(repo: string, first: WhisperDevice, onDevice: (d: WhisperDevice) => void): Promise<{ asr: Transcriber; device: WhisperDevice }> {
  const files = new Map<string, { loaded: number; total: number }>();
  let last = 0;
  const progress_callback = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file || !p.total) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    const now = Date.now();
    if (now - last < 150) return; // 너무 자주 보내지 않는다
    last = now;
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    port.postMessage({ type: 'download', loaded, total });
  };
  const devices: WhisperDevice[] = first === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
  let lastError: unknown;
  for (const device of devices) {
    for (const dtype of DTYPES[device]) {
      try {
        onDevice(device);
        // @ts-expect-error dtype·device는 문자열 유니온이라 목록에서 고른 값을 그대로 넘긴다
        const asr = (await pipeline('automatic-speech-recognition', repo, { device, dtype, progress_callback })) as unknown as Transcriber;
        return { asr, device };
      } catch (e) {
        lastError = e;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

port.onmessage = async (e) => {
  const req = e.data;
  try {
    port.postMessage({ type: 'stage', stage: 'model' });
    const { asr } = await load(req.repo, await pickDevice(), (d) => port.postMessage({ type: 'device', device: d }));
    port.postMessage({ type: 'stage', stage: 'transcribe' });
    const t0 = performance.now();
    const out = await asr(req.audio, {
      return_timestamps: 'word',
      language: req.language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const words: AsrWord[] = [];
    for (const c of out.chunks ?? []) {
      const text = (c.text ?? '').trim();
      const start = c.timestamp?.[0];
      if (!text || typeof start !== 'number') continue;
      const end = c.timestamp?.[1];
      words.push({ text, start, end: typeof end === 'number' && end > start ? end : start + 0.25 });
    }
    port.postMessage({ type: 'result', words, text: (out.text ?? '').trim(), ms: Math.round(performance.now() - t0) });
  } catch (err) {
    port.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
