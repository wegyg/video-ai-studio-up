# 자동 자막 (Whisper) 측정과 결정

## 확인한 API (@huggingface/transformers 4.3.0, Apache-2.0)
타입 정의(`types/pipelines/automatic-speech-recognition.d.ts`, `types/utils/hub.d.ts`)에서 확인한 것만 쓴다.

- `pipeline('automatic-speech-recognition', repo, { device, dtype, progress_callback })`
- 호출: `asr(Float32Array(16kHz 모노), { return_timestamps: 'word', language: 'korean', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })`
- 결과: `{ text, chunks: [{ text, timestamp: [시작초, 끝초] }] }` — `chunks`가 단어별 타이밍이다
- 단어별 타이밍은 **`_timestamped` 모델**에서만 나온다 (`onnx-community/whisper-*_timestamped`)
- 모델은 `env.allowLocalModels = false`로 Hugging Face에서 받고, 브라우저 캐시(Cache API)에 저장된다 → 두 번째부터 내려받지 않는다

## 모델 선택
| 화면 표시 | 저장소 | 그래픽 가속(q4f16) | CPU(int8 계열) |
|---|---|---|---|
| 빠름 | whisper-tiny_timestamped | 46MB | 101MB |
| **보통 (기본값)** | whisper-base_timestamped | 69MB | 180MB |
| 정확 | whisper-small_timestamped | 146MB | 547MB |

- 장치: `navigator.gpu.requestAdapter()`가 실제로 어댑터를 주면 WebGPU, 아니면 CPU(WASM). WebGPU로 모델을 못 만들면 CPU로 다시 시도한다.
- 양자화: WebGPU `q4f16 → fp16 → q8`, CPU `q8 → int8 → q4` 순서로 시도한다(저장소에 없는 형식은 건너뛴다).

## 샌드박스 측정 (2026-09-29)
**GPU가 없어 사용자 노트북 속도를 대표하지 못한다.** 여기서 확인한 것은 "경로가 끝까지 도는지"다.

| 항목 | 값 |
|---|---|
| 장치 | CPU(WASM, 단일 스레드 — GitHub Pages에는 COOP/COEP 헤더가 없어 여러 스레드를 쓸 수 없다) |
| 모델 | 빠름(tiny) |
| 소리 | 3초 |
| 첫 실행 (모델 받기 + 인식) | 21초 (인식 18초) |
| 두 번째 실행 (캐시) | 20초 — 내려받기 없음 |

- 정확도와 속도 기준(A6: 60초 한국어 음성 90초 이내)은 **사용자가 실제 한국어 음성으로 확인**한다. 샌드박스에는 한국어 음성을 만들 도구(TTS)가 없다.
- 검증 테스트: `WHISPER=1 npx playwright test captions-model` (가장 작은 모델 + 3초 소리). CI는 건너뛴다.

## 알게 된 것: 말이 없는 구간의 반복 환청
660Hz 순음 3초를 넣으니 Whisper가 같은 글자를 수백 번 반복한 한 덩어리를 내놓았다(`[(끝끝끝…`). 실제 음성에서도 조용한 구간에서 나타나는 알려진 현상이다. 그래서 `model/captions.ts`에서:

- 한 단어가 24자를 넘으면 자른다
- 같은 단어가 세 번 넘게 이어지면 앞 자막의 길이를 늘리는 것으로 합친다
- 한 자막은 최소 0.4초, 최대 3초

## 자막 만드는 규칙 (`model/captions.ts`)
- **문장 자막:** 18자까지 이어 붙이고, 0.6초 넘게 쉬거나 문장이 끝나면(`.!?…`) 줄을 바꾼다. 한 줄 최대 3초.
- **단어 강조:** 단어마다 클립 하나, 최소 8프레임, 등장 애니메이션 '팝'.
- 두 방식 모두 결과는 **보통 텍스트 클립**이라 글자·위치·스타일을 바로 고칠 수 있다. 자막은 서로 겹치지 않는다.

## 참고
- ONNX 런타임(wasm) 파일은 transformers.js 기본값대로 jsdelivr(공개 npm CDN)에서 받는다. 우리 저장소에 두면 83MB가 늘어난다. 모델·런타임 모두 브라우저에 캐시되고, 실행은 전부 브라우저 안에서 일어난다(외부 API·API 키 없음, R0.1).
