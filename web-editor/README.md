# 웹 영상 편집기

쇼츠·릴스용 세로 영상을 **설치 없이 브라우저에서** 편집하는 정적 웹앱입니다.
타임라인을 보면서 바로 편집하고(미리보기 대기 없음), 끝나면 MP4(H.264/AAC)로 내보냅니다.
모든 처리는 내 컴퓨터의 브라우저 안에서만 일어나며, 영상이 서버로 올라가지 않습니다.

## Windows에서 쓰기

**가장 쉬운 방법:** Chrome(최신)으로 아래 주소를 엽니다.

> https://wegyg.github.io/video-ai-studio-up/

**내 컴퓨터에서 직접 띄우기** (Node.js 20 이상 필요):
```
npm install
npm run build
npx serve dist
```
그다음 Chrome으로 `http://localhost:3000`을 엽니다.

> ⚠️ `dist/index.html`을 더블클릭해서(file://) 열면 동작하지 않습니다. 영상 처리 기능(WebCodecs)은 https 주소나 localhost에서만 켜지기 때문입니다. 이렇게 열면 편집기가 안내 화면을 보여 줍니다.

### 저장과 내보내기
- 편집 내용은 브라우저에 **자동 저장**됩니다(0.4초마다). 새로고침하거나 창을 닫았다 열어도 그대로입니다.
- 가져온 영상·소리 원본도 브라우저 저장소에 보관되어 다시 가져올 필요가 없습니다.
- 위쪽의 ⬇ 버튼은 **프로젝트 파일(.json)**을 저장합니다. 원본 미디어는 들어가지 않으므로, 다른 컴퓨터에서 열면 "미디어 다시 연결" 창에서 파일을 골라 주면 됩니다.
- **내보내기**를 누르면 저장 위치를 고르고, 1080×1920 30fps MP4를 만듭니다. 끝나면 걸린 시간이 표시됩니다.

### 효과 (왼쪽 '효과' 탭)
- **캔버스 배경:** 16:9 영상을 세로 화면에 넣었을 때 위아래 빈 곳을 단색 또는 흐린 원본으로 채웁니다.
- **필터 12종 + 조정**(밝기·대비·채도·색온도·선명도·비네트): 타임라인에서 클립을 고른 뒤 누르면 바로 바뀌고, 내보낸 MP4에도 똑같이 들어갑니다.
- 효과는 그래픽 가속(WebGL2)을 씁니다. Chrome 설정에서 그래픽 가속을 끄면 효과 없이 편집만 됩니다.

## 개발

| 명령 | 설명 |
|------|------|
| `npm run dev` | 개발 서버 (http://localhost:5173) |
| `npm run build` | 타입 검사 + 정적 빌드 → `dist/` |
| `npm run preview` | 빌드한 `dist/`를 http://localhost:4173 으로 띄우기 |
| `npm run test:unit` | 단위 테스트 (Vitest) |
| `npx playwright test` | E2E 테스트 (실제 Google Chrome 필요, `npm run build` 먼저) |
| `npm run fixtures:perf` | 성능 측정용 1080p 클립 5개 만들기 (ffmpeg 필요) |

E2E 테스트 중 일부는 추가 조건이 있을 때만 돕니다.
- `PERF_DIR=$PWD/.perf-fixtures` — 수용 기준 A1(재생 성능)·A2(60초 내보내기 시간). CPU를 많이 쓰므로 따로 하나씩 돌립니다:
  `PERF_DIR=$PWD/.perf-fixtures npx playwright test acceptance -g "A1|A2" --workers=1`
- `FFMPEG_PATH`, `FFPROBE_PATH` (또는 PATH의 ffmpeg) — 내보낸 MP4를 **Chrome이 아닌 디코더**로 풀어 미리보기와 비교(휴대폰 재생 확인)
- `BASE_URL=https://…` — 배포된 사이트를 대상으로 같은 테스트 실행

GitHub Actions(`.github/workflows/web-editor-pages.yml`)가 push마다 단위·E2E 테스트를 돌리고, 모두 통과하면 `dist/`를 GitHub Pages에 배포합니다.

## 기술
Vite + React + TypeScript, Zustand(+ zundo 실행 취소), Tailwind CSS, Canvas 2D 합성,
Mediabunny(MP4 읽기/쓰기, WebCodecs), IndexedDB(idb). 글꼴은 Pretendard와 Noto Sans KR을 앱에 포함합니다(SIL OFL 1.1, `src/assets/fonts/LICENSE-*.txt`).

문서: 요구사항·설계·태스크는 `.kiro/specs/web-video-editor/`, 기술 검증 결과는 `docs/spike.md`, 성능 측정은 `docs/perf.md`.
