# 설계 — 웹 영상 편집기 (1단계 MVP)

## 1. 확인한 라이브러리와 버전
2026-09-27에 `npm view`로 최신 버전을 확인했고, 사용할 API는 공식 문서에서 확인했다. 구현할 때는 이 버전으로 고정(`exact`)한다.

| 패키지 | 버전 | 용도 | 확인한 공식 문서 |
|--------|------|------|------------------|
| vite | 8.3.1 | 빌드/개발 서버 | vite.dev |
| react / react-dom | 19.3.0 | UI | react.dev |
| @vitejs/plugin-react | 6.1.1 | Vite React 플러그인 | — |
| typescript | 7.0.2 | 타입 검사 | — |
| tailwindcss / @tailwindcss/vite | 4.3.3 | 스타일 (v4, Vite 플러그인 방식) | tailwindcss.com/docs/installation/using-vite |
| zustand | 5.0.15 | 상태 관리 | — |
| zundo | 2.3.0 | 실행 취소/다시 실행 (`temporal` 미들웨어) | github.com/charkour/zundo README |
| mediabunny | 1.60.0 | MP4 읽기(디코딩)/쓰기(인코딩, 먹싱) | mediabunny.dev/guide/* |
| @mediabunny/aac-encoder | 1.60.0 | AAC 인코딩 대체(WASM) | mediabunny.dev/guide/extensions/aac-encoder |
| @ffmpeg/ffmpeg, @ffmpeg/util | 0.12.15, 0.12.2 | *(2단계)* WebCodecs가 없을 때만 쓰는 대체 인코더. 1단계에서는 설치하지 않는다 | ffmpegwasm.netlify.app |
| idb | 8.0.3 | IndexedDB 래퍼 | — |
| pretendard | 1.3.9 | 글꼴 (앱에 포함) | — |
| @playwright/test | 1.63.0 | E2E 테스트 | playwright.dev |

TypeScript 7과 Vite 8은 메이저 버전이 새로 올라간 상태다. 태스크 0에서 템플릿이 빌드되는지 먼저 확인하고, 문제가 있으면 바로 이전 메이저 버전으로 낮춘 뒤 이 표를 고친다.

### 사용할 Mediabunny API (문서에서 확인)
- 읽기: `new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })`, `input.computeDuration()`, `input.getPrimaryVideoTrack()`, `input.getPrimaryAudioTrack()`
- 디코딩: `new CanvasSink(videoTrack, { width, height, fit, poolSize })`의 `canvases(start, end)`, `canvasesAtTimestamps(ts)`, `getCanvas(t)`. 오디오는 `new AudioBufferSink(audioTrack)`의 `buffers(start, end)`
- 쓰기: `new Output({ format: new Mp4OutputFormat(), target })`, `new CanvasSource(canvas, { codec: 'avc', quality })`, `new AudioBufferSource({ codec: 'aac', quality })`, `output.addVideoTrack(src, { frameRate: 30 })`, `output.start()`, `source.add(...)`, `output.finalize()`, `output.cancel()`
- 저장 대상: `StreamTarget(await handle.createWritable())`(File System Access API, 문서에 공식 예시 있음) 또는 `BufferTarget`
- 기능 확인: `canEncodeVideo('avc', { width, height, frameRate, quality })`, `canEncodeAudio('aac', ...)`
- AAC 대체: `if (!(await canEncodeAudio('aac'))) registerAacEncoder()`

구현하면서 문서로 추가 확인할 항목: `CanvasSource`에 하드웨어 가속 옵션(`hardwareAcceleration`)을 넘기는 방법, zundo의 `pause()`/`resume()`. 프록시(보류)를 진행하게 되면 `Conversion` API의 해상도 옵션도 확인한다. 확인하기 전에는 쓰지 않는다.

## 2. 확인된 위험과 대응
| 위험 | 근거 | 대응 |
|------|------|------|
| Playwright 기본 Chromium(오픈소스 빌드)에는 H.264/AAC 같은 독점 코덱이 없다 | Playwright 이슈 #36550 등, 메인테이너 답변 | Playwright는 `chrome` 채널(`channel: 'chrome'`, 실제 Google Chrome, Chromium 엔진) 프로젝트 하나만 쓴다. H.264/AAC 테스트 파일로 사용자 환경과 같은 경로를 검증한다. ffmpeg.wasm 대체 경로는 2단계로 옮겼으므로 번들 Chromium은 쓰지 않는다 |
| Linux Chrome의 WebCodecs에는 AAC 인코더가 없을 수 있다 (Windows Chrome은 OS 인코더를 쓴다) | Mediabunny 문서: "일부 브라우저에는 AAC 인코딩이 없다" | `canEncodeAudio('aac')`가 false이면 `@mediabunny/aac-encoder`를 등록한다 |
| Linux Chrome에서 WebCodecs H.264 **인코딩** 지원 여부를 확인하지 못했다 | 확인하지 못함 | 태스크 0 스파이크에서 샌드박스와 CI(ubuntu) Chrome으로 실제로 확인하고 `docs/spike.md`에 기록한다 |
| 개발/CI 환경(Linux)과 사용자 환경(Windows Chrome)이 다르다 | — | CI는 ubuntu + Chrome만 쓴다(Windows CI 없음). 대신 태스크 5와 10 뒤에 사용자가 Windows Chrome에서 직접 확인한다 |
| 60초 내보내기(1800프레임)는 실시간 이상의 속도가 필요하다 | — | 순차 디코딩(`canvases()` 반복), 인코더 역압력(`await add()`), Web Worker와 OffscreenCanvas 사용. 느린 경로(탐색 기반 `getCanvas`)는 쓰지 않는다 |

## 3. 폴더 구조
```
web-editor/
  index.html
  vite.config.ts            # base: './' (어느 경로에 배포해도 동작)
  playwright.config.ts      # project: chrome (channel: 'chrome')
  public/fonts/             # Pretendard, NotoSansKR woff2 (앱에 포함)
  src/
    i18n/ko.ts              # 모든 UI 문자열
    model/                  # 타입, 순수 편집 함수 (분할/트림/이동/스냅/겹침)
      types.ts  ops.ts  snap.ts  time.ts
    store/                  # zustand + zundo
      project.ts  ui.ts  history.ts
    media/                  # 가져오기, 메타데이터, 썸네일, 파형, 프록시
      import.ts  thumbs.ts  waveform.ts  proxy.ts
    engine/
      compose.ts            # drawFrame(ctx, project, frame, sources) — 미리보기/내보내기 공용
      text.ts               # 텍스트 레이아웃/그리기
      preview/              # 재생 시계, <video> 풀, 오디오 그래프
      export/               # worker, WebCodecs 경로, ffmpeg.wasm 대체 경로
    storage/                # IndexedDB (idb), 자동 저장, JSON 가져오기/내보내기
    ui/                     # React 컴포넌트
      App.tsx  LeftPanel/  Preview/  Inspector/  Timeline/  ExportDialog/
    shortcuts.ts
  tests/
    fixtures/               # 작은 테스트 파일 (커밋)
    scripts/make-fixtures.mjs  # 테스트 파일 생성 스크립트 (FFMPEG_PATH 또는 PATH의 ffmpeg 사용)
    e2e/*.spec.ts
```
ffmpeg는 **개발자가 테스트 파일을 다시 만들 때만** 쓴다. 만든 파일은 커밋하므로 테스트 실행과 앱에는 ffmpeg가 필요 없고, 의존성에도 넣지 않는다.

## 4. 데이터 모델
시간은 모두 **정수 프레임**(30fps)으로 저장한다. 실수 오차가 없고 분할/스냅이 프레임에 정확히 맞는다. 화면 표시와 디코딩할 때만 초로 바꾼다.

```ts
type Ratio = '9:16' | '16:9' | '1:1';
interface Project {
  id: string; name: string; version: 1;
  ratio: Ratio; width: number; height: number; fps: 30;
  tracks: Track[];                 // 배열 순서 = 타임라인 위→아래
  assets: Record<string, AssetMeta>;
  playhead: number;                // 프레임
  updatedAt: number;
}
interface AssetMeta {
  id: string; kind: 'video' | 'image' | 'audio';
  name: string; size: number; mime: string;
  durationFrames?: number; width?: number; height?: number;
  hasAudio: boolean; hasProxy: boolean;
}
type TrackKind = 'video' | 'text' | 'audio';
interface Track { id: string; kind: TrackKind; name: string; muted: boolean; clips: Clip[] }

interface Transform { x: number; y: number; scale: number; rotation: number; opacity: number } // x,y = 캔버스 중심 기준 px
interface ClipBase { id: string; start: number; duration: number }
interface MediaClip extends ClipBase {
  type: 'video' | 'image' | 'audio'; assetId: string;
  inPoint: number;                 // 원본에서의 시작 프레임
  volume: number; fadeIn: number; fadeOut: number;   // 1 = 100%, 페이드는 프레임
  speed: 1;                        // 2단계에서 확장
  transform: Transform;            // audio는 사용하지 않음
}
interface TextClip extends ClipBase {
  type: 'text'; text: string;
  font: 'Pretendard' | 'Noto Sans KR'; size: number; weight: 400 | 700 | 900;
  color: string; align: 'left' | 'center' | 'right';
  stroke: { color: string; width: number };
  box: { enabled: boolean; color: string; opacity: number; padding: number };
  transform: Transform;
}
type Clip = MediaClip | TextClip;
```

### 편집 연산 (`model/ops.ts`, 순수 함수)
- `moveClip(project, clipId, toTrackId, toStart)`: 트랙 종류를 검사하고, 겹치면 `resolveOverlap`으로 가장 가까운 빈 구간을 찾는다. 자리가 없으면 원래 상태를 돌려준다.
- `trimClip(project, clipId, edge, newFrame)`: 왼쪽을 트림하면 `start`와 `inPoint`를 같이 옮긴다. 영상/오디오는 `inPoint >= 0`, `inPoint + duration <= asset.durationFrames` 범위로 제한한다.
- `splitClip(project, clipId, atFrame)`: 왼쪽은 `duration = at - start`, 오른쪽은 `start = at`, `inPoint += at - start`. 페이드는 왼쪽에 fadeIn, 오른쪽에 fadeOut만 남긴다.
- `snap(frame, candidates, pxPerFrame, thresholdPx = 8)`: 후보는 다른 클립의 가장자리, 플레이헤드, 0이다.

## 5. 상태 관리와 실행 취소
- `useProject` 스토어: `Project` + 편집 액션. zundo `temporal`로 감싸고 `partialize`로 `tracks`, `assets`, `ratio`만 기록한다. 플레이헤드와 선택 상태는 기록하지 않는다.
- `useUI` 스토어(기록 안 함): 선택된 클립, 줌(px/프레임), 스냅 켜짐 여부, 재생 중 여부, 좌측 탭.
- 드래그 한 번 = 기록 1개: 포인터를 누를 때 기록을 멈추고, 드래그 중에는 상태를 바로 갱신해 미리보기에 반영한다. 포인터를 뗄 때 기록을 다시 켜고 최종 상태를 한 번 커밋한다. zundo의 `pause`/`resume` API를 문서로 확인한 뒤 쓰고, 없으면 드래그 중 상태를 UI 스토어에 두었다가 뗄 때 한 번만 반영한다.

## 6. 미리보기 엔진
### 합성 (`engine/compose.ts`)
`drawFrame(ctx, project, frame, sources)`는 **미리보기와 내보내기가 같이 쓰는** 순수 그리기 함수다.
1. 검은 배경을 칠한다.
2. 영상 트랙을 아래 트랙부터 위 트랙 순서로 돈다. 이 프레임에 걸린 클립의 소스(`sources.getVisual(clipId)`: HTMLVideoElement, ImageBitmap, 또는 Canvas)를 `transform`(이동→회전→크기, 투명도)으로 그린다. 기본 크기는 캔버스를 채우는 contain 맞춤이다.
3. 텍스트 트랙을 그린다(`engine/text.ts`: 줄바꿈 → 배경 박스 → 외곽선(`strokeText`, `lineJoin='round'`) → 채우기).

### 재생 시계
- 재생 중에는 `AudioContext.currentTime`을 기준 시계로 쓴다(오디오 기준 동기화). 정지 중에는 플레이헤드가 기준이다.
- `requestAnimationFrame` 루프에서 현재 프레임을 계산하고 `drawFrame`을 호출한다. 화면 갱신은 60fps, 영상 내용은 30fps다.
- React는 캔버스를 다시 그리지 않는다. 루프가 스토어를 `getState()`로 직접 읽어 React 재렌더링 비용을 피한다.

### 영상 소스 풀
- 클립마다 숨겨진 `<video muted=false playsinline>`를 하나씩 둔다. `src`는 IndexedDB Blob의 `URL.createObjectURL`(프록시가 있으면 프록시)이다. 현재 프레임 ±2초 안에 있는 클립만 만들고 나머지는 정리한다.
- 재생 중: 클립 구간에 들어가면 `currentTime = (inPoint + frame - start) / 30`으로 맞추고 `play()`한다. 기준 시계와 1프레임 넘게 어긋나면 `currentTime`으로 다시 맞춘다. 다음 클립은 미리 탐색해 둔다(끊김 방지).
- 정지/스크럽 중: `currentTime`을 설정하고 `seeked` 이벤트가 오면 다시 그린다. 스크럽이 빠르면 마지막 요청만 처리한다.
- 이미지는 `createImageBitmap`으로 한 번 디코딩해 캐시한다.

### 오디오 그래프 (미리보기)
각 `<video>`/`<audio>` → `MediaElementAudioSourceNode` → 클립 `GainNode` → 트랙 `GainNode`(음소거) → 출력. 볼륨과 페이드는 프레임마다 `gain.setTargetAtTime`으로 적용한다. 곡선은 내보내기와 같은 `gainAt(clip, frame)` 함수를 쓴다(R8.4).

### 미리보기 직접 조작
캔버스 위에 같은 크기의 DOM 오버레이를 두고, 선택한 클립의 경계 상자, 모서리 핸들 4개, 회전 핸들 1개를 그린다. 포인터 좌표를 캔버스 좌표로 바꿔 `transform`을 갱신한다. Shift를 누르면 비율을 유지하고, 회전은 15° 단위로 스냅한다. 빈 곳을 클릭하면 이 프레임의 가장 위 클립을 고른다(`hitTest`, 회전을 고려한 역변환).

## 7. 타임라인 UI
- DOM 기반이다. 클립 하나가 절대 위치 `div` 하나이고, 위치는 `transform: translateX`로 옮긴다. 가로 크기는 `start * pxPerFrame`으로 정한다.
- 필름스트립: 가져올 때 `CanvasSink(track, { height: 64, poolSize: 1 })`의 `canvasesAtTimestamps`로 1초마다 썸네일을 뽑고, 스프라이트 한 장(WebP Blob)으로 IndexedDB에 캐시한다. 클립 div 배경에 보이는 구간만 반복해 그린다.
- 파형: `AudioBufferSink.buffers()`로 디코딩하고 초당 100개의 최대 진폭(peak)을 `Float32Array`로 캐시한다. 클립마다 작은 canvas에 보이는 구간만 그린다.
- 드래그와 트림은 Pointer Events와 `setPointerCapture`를 쓴다. 이동 중에는 `requestAnimationFrame`으로 모아서 한 번에 갱신한다.
- 줌: `pxPerFrame` 0.2~20 범위(로그 슬라이더). Ctrl+휠로 커서 위치를 기준으로 확대/축소한다.

## 8. 저장 (`storage/`)
IndexedDB 데이터베이스 `web-editor`, 스키마 v1:
| 저장소 | 키 | 값 |
|--------|----|----|
| `projects` | project.id | Project JSON |
| `media` | asset.id | 원본 Blob |
| `derived` | `${assetId}:thumbs` / `:peaks` / `:proxy` | 필름스트립, 파형, 프록시 Blob |
| `meta` | `'lastProjectId'` | string |

- 자동 저장: 스토어를 구독하고 500ms 디바운스 후 `projects`에 쓴다(R10.1: 1초 이내). `beforeunload` 때도 한 번 더 저장한다.
- 시작할 때 `navigator.storage.persist()`를 요청하고, `navigator.storage.estimate()`로 남은 공간을 확인한다. 부족하면 경고한다.
- JSON 내보내기: `{ format: 'web-editor-project', version: 1, project }`를 다운로드한다. 가져올 때 스키마를 검사하고, `media`에 없는 assetId는 "다시 연결" 목록에 올린다. 사용자가 파일을 고르면 이름과 크기가 같은지 확인한 뒤 연결한다.

## 9. 내보내기 (`engine/export/`)
### 경로 선택
```
VideoEncoder 있음 && canEncodeVideo('avc', {width,height,frameRate:30, bitrate})
  → WebCodecs 경로 (AAC: canEncodeAudio('aac') ? 기본 : registerAacEncoder())
그 외 → ffmpeg.wasm 경로 (느림 안내)
```

### WebCodecs 경로 (Web Worker)
1. 메인 스레드: 저장 대상을 정한다(`showSaveFilePicker`가 있으면 파일 핸들, 없으면 메모리 버퍼). 프로젝트 JSON과 미디어 Blob을 Worker에 넘긴다(Blob은 복사 없이 전달된다).
2. Worker: 원본(프록시 아님)마다 `Input` + `CanvasSink`를 만든다. 클립마다 `canvases(inStart, inEnd)` 비동기 반복자를 열어 **순서대로** 프레임을 받는다(탐색 없이 빠르다).
3. `OffscreenCanvas(width, height)`에 프레임마다 `drawFrame`을 호출한 뒤 `await canvasSource.add(frame / 30, 1 / 30)`한다. await가 인코더 역압력이 되어 메모리 사용량이 일정하게 유지된다.
4. 오디오: `OfflineAudioContext(2, 48000 * 길이초, 48000)`에 모든 오디오를 배치하고, 볼륨/페이드는 `gainAt`과 같은 곡선으로 자동화한다. `startRendering()` 결과를 `AudioBufferSource.add()`로 넣는다. 오디오를 먼저 넣으면 패킷 버퍼링이 쌓이므로 **영상 10초 → 오디오 10초 구간**을 번갈아 넣는다(문서의 인터리빙 권고).
5. 진행률 = 인코딩된 프레임 수 / 전체 프레임 수. 1초마다 메인 스레드로 보내고, ETA는 최근 3초 평균 속도로 계산한다.
6. 취소: 메인 스레드가 `cancel` 메시지를 보내면 Worker가 `output.cancel()`하고 `Input`을 dispose한 뒤 끝낸다. 파일 대상이면 부분 파일을 지우도록 안내한다.
7. 글꼴: Worker에서 `new FontFace(...)`로 같은 woff2를 불러와 `self.fonts.add()`한다.

영상 비트레이트: 1080×1920 30fps는 10Mbps, 오디오는 AAC 192kbps.

### ffmpeg.wasm 대체 경로 *(2단계로 이동 — 1단계에서는 R1.3 안내 화면만)*
단일 스레드 코어(`@ffmpeg/core`)를 쓴다. 멀티스레드 코어는 COOP/COEP 헤더가 필요한데 정적 호스팅에서는 보장할 수 없기 때문이다. 코어 파일은 CDN이 아니라 `dist/`에 포함한다. 프레임을 JPEG로 그려 가상 파일 시스템에 쓰고, WAV로 렌더링한 오디오와 함께 `libx264` + `aac`로 인코딩한다. "이 브라우저는 하드웨어 인코딩을 지원하지 않아 느립니다"라고 안내하고 진행률과 취소를 똑같이 제공한다.

## 10. 프록시 *(보류 — 사용자 확인 1에서 실제 촬영본의 미리보기가 끊길 때만 진행)*
긴 변이 1080px을 넘는 영상을 가져오면 프록시 생성을 제안한다. Mediabunny `Conversion`으로 긴 변 960px, H.264 2Mbps로 변환해 `derived`에 저장한다. 해상도 옵션은 구현 전에 문서로 확인한다. 프록시 사용 여부는 미디어별로 켜고 끌 수 있다. 내보내기는 항상 원본을 쓴다.

## 11. 테스트 전략
- **Vitest**(단위, 빠름): `model/ops.ts`, `snap.ts`, `time.ts`, `gainAt`. 분할/트림/겹침의 경계 조건을 검사한다.
- **Playwright**:
  - `chrome` 프로젝트 하나(`channel: 'chrome'`): H.264/AAC 테스트 파일로 실제 사용자 경로를 검증한다
  - 테스트 대상은 `vite build` 후 `vite preview`(localhost)로 띄운 **정적 빌드**다. 개발 서버로 테스트하지 않는다.
  - 기본 시나리오(A4): `setInputFiles`로 가져오기 → 타임라인에 끌어 넣기 → 플레이헤드 이동 → S → 텍스트 추가 → 내보내기 → 다운로드 파일을 페이지 안에서 Mediabunny로 다시 읽어 코덱, 해상도, 길이를 검사한다.
  - 복원(A3): 편집 → `page.reload()` → 스토어 JSON 비교
  - 성능(A1): 1080p 12초 클립 5개(테스트 전에 생성) → `PerformanceObserver('longtask')`로 드래그/트림 중 50ms 초과 작업 수, 재생 중 rAF 간격으로 프레임 드롭 비율을 잰다
  - 한글 글꼴: 텍스트 클립을 넣은 미리보기 캔버스를 캡처하고, 글꼴을 쓰지 않았을 때(□)와 픽셀이 다른지 비교한다
- **CI**(GitHub Actions): `ubuntu-latest` + Playwright `chrome` 채널만 쓴다(Windows 매트릭스 없음). 결과물은 테스트 리포트와 내보낸 샘플 MP4 아티팩트뿐이다.

## 12. 배포
- `vite.config.ts`에서 `base: './'`로 설정해 어느 경로에 올려도 동작하게 한다. 서버 코드는 없다.
- **GitHub Pages(기본):** `.github/workflows/web-editor-pages.yml`이 작업 브랜치(또는 main)에 push될 때 실행된다. 순서는 `web-editor/` 단위 테스트 → 빌드 → Playwright 테스트이고, 모두 통과하면 `dist/`를 **`gh-pages` 브랜치**에 올린다(`.nojekyll` 포함). 주소는 `https://wegyg.github.io/video-ai-studio-up/`이다. Pages는 https라 WebCodecs가 동작한다.
  - 원래 계획은 `actions/deploy-pages`였다. 이 방식은 저장소 설정 변경(Pages 소스를 "GitHub Actions"로 바꾸기, `github-pages` 환경의 브랜치 허용)이 필요한데, 샌드박스 인증으로는 설정 API가 403으로 거부되었다. `gh-pages` 브랜치 방식은 브랜치를 올리는 순간 Pages가 자동으로 켜져서(확인 완료: build_type=legacy, source=gh-pages) 사용자가 설정할 것이 없다.
  - 배포 확인: `DEPLOY_URL=… npx playwright test deployed`는 배포본이 로컬 최신 빌드와 같은지(번들 해시), https에서 편집기와 인코딩·글꼴이 되는지 검사한다.
- README에 적을 다른 실행 방법: 로컬에서 `npx serve dist` 실행 후 Chrome으로 `http://localhost:3000` 열기. file://로 열면 WebCodecs가 동작하지 않으므로 앱이 안내 화면을 보여 준다(R1.3).


---

# 2단계·3단계 설계 메모 (확인 1 뒤 추가)

## 13. 효과 합성 — Canvas 2D + WebGL2 셰이더 (2단계 결정)
처음 계획(합성 전체를 WebGL2로 바꾸기)은 쓰지 않는다. 1단계에서 검증한 배치·텍스트·오디오 경로와 약 70개 E2E를 다시 만들 위험이 크고, WebGL이 없는 환경에서 편집 자체가 멈추기 때문이다.

- **배치·텍스트는 그대로** `drawFrame`(Canvas 2D, 미리보기·내보내기 공용)이 그린다.
- **필터·흐림 배경(그리고 이후 트랜지션·효과)만** `engine/gl/effects.ts`의 WebGL2 셰이더가 처리하고, 결과 캔버스를 `drawImage`로 다시 얹는다. 미리보기는 공용 인스턴스(`sharedEffects`), 내보내기 Worker는 자기 인스턴스(`createEffects`, OffscreenCanvas)를 쓰지만 **셰이더 코드는 같다**(R0.3, R11.8).
- 필터 식은 두 곳에 있다: 셰이더 `FS_FILTER`와 `model/filters.ts`의 `adjustPixel`(설계식). `filters.spec`이 12종 모두 두 값을 비교하므로 한쪽만 고치면 테스트가 깨진다.
- 흐림 채우기: 프로젝트 해상도의 1/8로 cover 크롭 → 가로·세로 분리 가우시안(σ = 정도/100 × 10, 반경 ≤ 32). 맨 아래 영상이 회전 없이 화면을 불투명하게 다 덮으면 계산을 건너뛴다.
- 미리보기 해상도가 작을 때 필터의 픽셀 단위 값(선명도·흐림)은 `effectScale`로 맞춘다(내보내기 1, 미리보기 = 캔버스/프로젝트 비율).
- WebGL2를 만들 수 없으면 효과만 빼고 그리며 효과 탭에 한국어 안내를 띄운다(R13).

### 트랜지션 (2-2, `model/transitions.ts`)
- 저장: 뒤 클립의 `transitionIn = { kind, duration(프레임) }`. 같은 영상 트랙에서 앞 클립 끝 = 뒤 클립 시작일 때만 유효하다.
- 구간: 경계를 가운데 두고 [경계 − floor(d/2), 경계 + ceil(d/2)). 진행도 = (프레임 − 시작 + 0.5) / d. **타임라인은 줄지 않는다**(캡컷처럼 클립을 겹쳐 뒤를 당기면 자막·BGM이 영상과 어긋난다).
- 길이 제한: 앞에서부터 차례로 정한다. 앞 클립은 자기 앞 트랜지션이 쓰고 남은 부분만, 뒤 클립은 자기 길이만큼 내준다 → 한 클립 양쪽 트랜지션이 겹치지 않는다. 최대 2초.
- 범위 밖 프레임: `sourceFrame` = 원본 번호를 원본 길이 안으로 자른 값. 자르고 남은 여분이 있으면 이어서, 없으면 끝 프레임에 멈춘다. 미리보기는 그 구간에서 `<video>`를 계속(또는 미리) 재생하고 소리는 클립 범위 밖에서 0, 내보내기는 리더의 읽기 범위를 구간만큼 넓힌다. 두 쪽이 같은 함수를 쓴다.
- 합성: 두 클립을 각자 배치·필터까지 그린 장면 두 장(투명 배경, 프로젝트 해상도 × 배율)을 셰이더 `FS_TRANSITION`으로 섞는다(알파를 곱한 채로 올려 가장자리 검은 테가 없게). 무작위처럼 보이는 값(글리치)은 정수 해시라 미리보기와 내보내기(서로 다른 GL 컨텍스트)가 같다. 흐림 배경은 두 클립의 흐린 배경을 진행도만큼 섞는다. WebGL이 없으면 경계에서 바로 바뀐다.
- 정리: 편집할 때마다(드래그 중에는 끝날 때 한 번) 맞닿지 않은 경계의 트랜지션을 지우고 길이를 실제 값으로 맞춘다. 끌다가 제자리로 오면 기록을 남기지 않는다.

### 키프레임 (2-3, `model/keyframes.ts`)
- 저장: 클립의 `keyframes = { x|y|scale|rotation|opacity|volume: [{ f, v, ease }] }`. `f`는 클립 시작 기준 프레임, `ease`는 그 키에서 다음 키까지(선형 / 부드럽게 = smoothstep).
- 값: 첫 키 앞·마지막 키 뒤는 그 키 값, 사이는 보간. 키가 없는 속성은 클립 값. 그리기(`drawFrame`)는 프레임마다 `clipAtFrame`으로 배치를 바꿔 그리므로 미리보기·내보내기가 같다. 소리는 `gainAt`이 볼륨 키를 따르므로 미리보기 GainNode와 내보내기 믹스가 같다.
- 고치기: 키가 있는 속성은 플레이헤드 시각의 키를 고치거나 새로 만든다(속성 패널·미리보기 끌기 공통 `setValues`). 앞 자르기·나누기는 키 오프셋을 옮겨 타임라인의 같은 순간에 남긴다. 범위 밖 키도 남겨 값이 끊기지 않게 한다.
- 내보내기 디코딩 크기는 키 중 가장 큰 크기 기준(확대해도 흐려지지 않게).

### 속도 (2-4)
- `speed`(0.25~4): 원본 프레임 = `inPoint + (타임라인 프레임 − 시작) × speed` (`srcAt`). 트랜지션 여분·자르기·나누기·필름스트립·파형이 모두 이 식을 쓴다.
- 속도를 바꾸면 쓰는 원본 구간을 유지한 채 길이를 바꾸고, 같은 트랙의 뒤 클립을 그만큼 옮긴다(맞닿은 곳·트랜지션 유지). 자막·BGM이 있는 다른 트랙은 옮기지 않는다.
- 소리: 미리보기는 `playbackRate` + `preservesPitch`. 내보내기는 음 높이 유지면 WSOLA(창 40ms Hann, 50% 겹침, ±10ms 안에서 가장 잘 이어지는 곳 찾기, 모든 채널 같은 위치), 아니면 `AudioBufferSourceNode.playbackRate`.

### 오버레이 (2-5)
- 로고·화면 속 화면은 새 기능이 아니라 **위 영상 트랙의 사진·영상 클립**이다(투명 PNG는 2D 합성에서 그대로 투명). "위에 얹기"는 트랙 선택과 기본 배치(오른쪽 위, 안전 영역 아래)만 정한다.
- 도형은 새 클립 종류 `shape`(원본 파일 없음, `isMedia`가 아님). `drawFrame`이 영상 트랙 순서대로 Canvas 2D 경로로 그리므로 미리보기·내보내기가 같다. 선택 상자 크기 = 도형 가로·세로 × 크기.

### 덕킹·오디오 분리 (2-6)
- 덕킹 곡선: 프레임마다 "다른 소리 있음" = 덕킹하지 않는 소리 나는 클립 중 하나라도 (원본 피크 × gainAt) > 0.05. 6프레임 앞당겨 1로, 끝나면 15프레임에 걸쳐 0으로. 덕킹 클립 크기 = gainAt × (1 − 곡선 × (1 − duck)). 피크는 가져올 때 만든 파형(초당 100개)이라 미리보기와 내보내기가 같은 값을 본다.
- 오디오 분리: 새 `audio` 클립이 같은 원본(영상 파일)을 가리킨다. 미리보기는 `<audio>`로 영상 파일의 소리를 틀고, 내보내기는 영상 파일의 오디오 트랙을 디코딩한다. 영상 클립의 `audioDetached`가 켜지면 그 클립은 소리를 내지 않는다.

### 원본 색 해석 맞추기 (`media/color.ts`)
미리보기는 `<video>`가, 내보내기는 WebCodecs(Mediabunny)가 원본을 푼다. 원본에 색 정보(primaries·transfer·matrix)가 셋 다 있지 않으면:
- Chrome `<video>`: 모두 버리고 세로(natural) 720 미만은 BT.601, 이상은 BT.709로 가정 (Chromium `media/ffmpeg/ffmpeg_common.cc`, VP9·AV1 제외)
- Mediabunny 1.60: 빈 칸만 BT.709로 채움 (`media-sink.js` VideoDecoderWrapper)

그래서 색 정보 없는 SD 영상은 내보내면 색이 평균 8/255 달라졌다. 내보내기·썸네일 Worker는 트랙의 `getDecoderConfig()`가 Chrome과 같은 색 공간을 돌려주게 바꾼 뒤 CanvasSink를 만든다. 두 길이 같은 디코더 설정을 쓰므로 디코더 종류(Windows 하드웨어 포함)와 상관없이 같은 색이 된다. 검증: `color.spec`(크기·태그 20가지를 ffmpeg BT.601/BT.709 강제 디코딩과 대조해 규칙을 확인했고, 저장소에는 대표 4개를 둔다).

## 14. 3단계 AI (로컬 실행)
확인한 사실은 tasks.md 3단계 머리말에 적었다. 설계 요점만 둔다.

- **실행 위치:** 전용 Worker. 편집을 막지 않고 취소할 수 있다.
- **모델 캐시:** 한 번 내려받아 Cache API 또는 IndexedDB에 저장한다. 진행률은 바이트 기준으로 보여 준다(R0.2).
- **Google 서버 의존 제거:** `@mediapipe/tasks-vision`의 WASM 런타임은 npm 패키지에 있으므로 우리 사이트에서 직접 호스팅한다. `.task` 모델 파일은 패키지에 없으므로 저장소에 넣거나 한 번 받아 캐시한다. 런타임에 Google 서버를 부르지 않는다(R0.1).
- **Whisper 단어별 타이밍:** `onnx-community/whisper-*_timestamped` 저장소를 쓴다(일반 내보내기에는 단어 정렬에 필요한 출력이 없다). 모델 크기별 속도·정확도는 태스크 21 스파이크에서 한국어 음성으로 측정해 `docs/whisper.md`에 기록하고, 그 결과로 기본값을 정한다.
- **WebGPU:** `device: 'webgpu'`를 우선 쓰고 안 되면 WASM으로 되돌아간다. `q4f16` 같은 fp16 계열 양자화는 WebGPU가 필요한지 스파이크에서 확인한다.
