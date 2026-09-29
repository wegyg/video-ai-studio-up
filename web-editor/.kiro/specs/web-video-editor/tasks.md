# 태스크 — 웹 영상 편집기 (1단계 MVP)

## 공통 규칙
- **작업 범위:** 모든 파일은 `web-editor/` 안에만 만든다. 기존 Python/Electron 앱(저장소의 나머지 파일)은 건드리지 않는다.
  예외는 하나뿐이다. GitHub Actions 워크플로 파일은 GitHub 규칙상 저장소 루트의 `.github/workflows/`에 있어야 하므로 새 파일 `web-editor-pages.yml`만 추가한다. 이 워크플로는 `web-editor/`만 빌드하고, 기존 워크플로는 수정하지 않는다.
- **태스크 완료 조건:** `npm run build` 통과 + `npx playwright test` 통과(그 시점까지의 전체 테스트) + 커밋.
  태스크 2.5 이후에는 여기에 **GitHub Pages 배포 성공**이 더해지고, 태스크마다 접속 주소를 보고한다. 하나라도 실패하면 다음 태스크로 넘어가지 않는다.
- **Playwright 브라우저:** `chrome` 채널(실제 Google Chrome, Chromium 엔진) 프로젝트 하나만 쓴다. 번들 Chromium에는 H.264가 없고, 대체 인코더(ffmpeg.wasm)는 2단계로 옮겼기 때문이다.
- **⏸ 사용자 확인 지점:** 태스크 5와 태스크 10이 끝나면 멈춘다. 사용자가 Windows Chrome에서 확인할 시나리오를 3줄로 전달하고, 확인을 받기 전에는 다음 태스크를 시작하지 않는다.
- 같은 오류가 두 번 나면 멈추고, 가설 2개를 적어 보고한다.

---

- [x] **0. 프로젝트 골격 + 기술 검증 스파이크**
  - `web-editor/`에 Vite + React + TS + Tailwind v4 골격을 만들고 버전을 고정한다. Vite 8/TS 7에서 빌드가 실패하면 이전 메이저로 낮추고 design.md 표를 고친다.
  - Playwright 설정(`chrome` 프로젝트 하나, `vite preview` webServer)
  - 테스트 파일: H.264/AAC mp4, mov, png, jpg, mp3, wav (각각 짧게, 커밋)
  - 스파이크 테스트: `canEncodeVideo('avc', 1080×1920)`, `canEncodeAudio('aac')`, 테스트 mp4 디코딩, Pretendard/Noto Sans KR 로드를 확인하고 결과를 `web-editor/docs/spike.md`에 기록한다
  - 확인할 문서: CanvasSource 하드웨어 가속 옵션, zundo pause/resume
  - _요구사항: R1.1, R1.4, 설계 §1–2_

- [x] **1. 데이터 모델 + 편집 연산 + 스토어**
  - `model/types.ts`, `ops.ts`(move/trim/split/delete/resolveOverlap), `snap.ts`, `time.ts`, Vitest 단위 테스트
  - `store/project.ts`(zustand + zundo, partialize), `store/ui.ts`
  - _요구사항: R5.1–R5.6, R9.3_

- [x] **2. 레이아웃 셸 + 한국어 문자열 + 단축키**
  - 좌측 탭 / 중앙 미리보기 / 우측 속성 / 하단 타임라인 뼈대, `i18n/ko.ts`
  - 비율 전환(9:16, 16:9, 1:1), `shortcuts.ts`(입력 칸 포커스 예외)
  - WebCodecs 미지원/file:// 안내 화면 (R1.3)
  - E2E: 레이아웃 표시, 비율 전환, 영어 UI 문자열 grep 0건 검사
  - _요구사항: R1.3, R2, R3, R9.1–R9.2_

- [x] **2.5 GitHub Pages 자동 배포** *(추가)*
  - Pages 소스: `gh-pages` 브랜치. 저장소 설정 API는 샌드박스 인증으로 403이라 쓸 수 없었다. `gh-pages` 브랜치를 올리면 Pages가 자동으로 켜진다(design.md §12)
  - 워크플로 `.github/workflows/web-editor-pages.yml`: ubuntu-latest에서 `npm ci` → 단위 테스트 → `npm run build` → Playwright(chrome) 테스트 → 통과하면 `web-editor/dist`를 `gh-pages`에 올린다. 테스트가 실패하면 배포하지 않는다
  - 트리거: 작업 브랜치에 push(`web-editor/**` 변경 시) + 수동 실행
  - 확인: 배포된 주소를 Playwright로 열어 앱이 뜨는지 검사하고 주소를 보고한다
  - 이 태스크 이후로는 태스크가 끝날 때마다 배포하고 접속 주소를 보고한다
  - _요구사항: R1.1, R1.2_

- [x] **3. 미디어 가져오기 + IndexedDB 미디어 저장 + 썸네일/필름스트립/파형**
  - 드래그앤드롭/파일 선택, 메타데이터(Mediabunny), 디코딩 불가 파일 거부 메시지
  - `storage/` media·derived 저장소, 필름스트립, 파형 피크
  - E2E: 6가지 형식 가져오기, 썸네일 표시, 잘못된 파일 거부
  - _요구사항: R4.1–R4.4, R10.2_

- [x] **4. 타임라인 편집**
  - 트랙(영상 2 + 텍스트 1 + 오디오 1, 추가 가능), 클립 렌더(필름스트립/파형), 미디어 패널에서 끌어 넣기
  - 드래그 이동, 양끝 트림, 분할, 삭제, 스냅, 겹침 보정, 줌 슬라이더/Ctrl+휠, 플레이헤드 드래그
  - E2E: 끌어 넣기 → 이동 → 트림 → S 분할 → Delete → Ctrl+Z/Ctrl+Y
  - _요구사항: R4.5, R5, R9_

- [x] **5. 실시간 미리보기 엔진**
  - `engine/compose.ts drawFrame`, 재생 시계(AudioContext), `<video>` 풀, 이미지 캐시, 스크럽, ←/→ 프레임 이동, 시간 표시
  - 오디오 그래프(볼륨/페이드 `gainAt`)
  - E2E: 재생 후 시간 증가, 스크럽한 프레임의 픽셀이 해당 소스와 일치
  - _요구사항: R3.3, R6.1–R6.3, R6.5_
  - **⏸ 사용자 확인 1 — 대기 중:** Windows Chrome 확인 시나리오 3줄을 전달하고 멈춘다. 사용자의 실제 촬영본으로 미리보기가 끊기는지도 이때 확인한다(태스크 12 진행 여부 결정)
  - 성능 측정(샌드박스, GPU 없음): `docs/perf.md`

- [ ] **6. 미리보기 직접 조작 + 우측 속성 패널**
  - 선택 상자, 이동/크기/회전 핸들, hitTest, Shift 비율 유지, 15° 스냅
  - 속성 패널(위치, 크기, 회전, 투명도, 볼륨, 속도 1배 읽기 전용) 양방향 연동
  - E2E: 핸들을 드래그하면 속성 값이 바뀌고, 실행 취소 1회로 되돌아감
  - _요구사항: R3.4, R6.4, R9.3_

- [ ] **7. 텍스트 클립**
  - 글꼴 포함(Pretendard, Noto Sans KR), `engine/text.ts`, 서식 패널, 더블클릭 인라인 편집, 등장/퇴장 숫자 입력
  - E2E: 한글 텍스트 렌더링 픽셀 검사(□ 아님), 서식 변경 반영
  - _요구사항: R7_

- [ ] **8. 오디오 편집**
  - 클립 볼륨(0–200%), 페이드 인/아웃 핸들과 표시, BGM 트랙, 트랙 음소거
  - Vitest: `gainAt` 곡선 / E2E: 페이드 설정 후 타임라인 표시
  - _요구사항: R8_

- [ ] **9. 자동 저장/복원 + 프로젝트 JSON**
  - 500ms 디바운스 자동 저장, lastProjectId, 저장 공간 확인/경고, JSON 내보내기/가져오기, 미디어 다시 연결
  - 어떤 프로젝트도 참조하지 않는 원본·파생 데이터 정리 (태스크 3부터 가져온 원본은 저장되지만 태스크 9 전에는 새로고침 뒤 목록이 복원되지 않아 쌓일 수 있다)
  - E2E(A3): 편집 → 새로고침 → 동일 상태, JSON 왕복
  - _요구사항: R10_

- [ ] **10. MP4 내보내기 (WebCodecs + Mediabunny)**
  - Worker, 순차 디코딩(CanvasSink.canvases), OffscreenCanvas `drawFrame`, CanvasSource(avc), OfflineAudioContext 믹스 + AudioBufferSource(aac), AAC 대체 등록, 영상/오디오 인터리빙
  - 진행률/경과/ETA, 취소, showSaveFilePicker + StreamTarget / 다운로드
  - **내보내기가 끝나면 걸린 시간을 화면에 표시한다**(예: "60초 영상 · 내보내기 42.3초"). A2는 사용자가 이 값으로 측정한다
  - E2E(A4 일부): 내보낸 MP4를 다시 읽어 코덱, 해상도, 길이 검증
  - _요구사항: R11.1–R11.3, R11.5–R11.8_
  - **⏸ 사용자 확인 2:** Windows Chrome 확인 시나리오 3줄(60초 영상 내보내기 시간 측정 포함)을 전달하고 멈춘다

- [ ] **13. 수용 기준 테스트 + CI**
  - 성능용 파일 준비(1080p 12초 × 5), A1 성능 테스트, A2 내보내기 소요 시간 기록, A3, A4 기본 시나리오
  - CI: ubuntu-latest + Playwright `chrome` 채널만 사용한다(windows-latest 매트릭스 없음). 리포트와 샘플 MP4를 아티팩트로 올린다
  - _요구사항: 수용 기준 A1–A4_

- [ ] **14. README + 배포 안내**
  - `npm run dev` / `npm run build` / `dist/` 설명
  - Windows에서 여는 방법: GitHub Pages 주소(기본), 또는 `npx serve dist` → Chrome으로 localhost 열기. file://로 열지 말 것
  - _요구사항: R1_

---

## 보류 / 2단계로 이동
- **12. 프록시 — 보류.** 사용자 확인 1에서 실제 촬영본의 미리보기가 끊길 때만 진행한다. 진행하게 되면 태스크 13 전에 넣는다.
  - 1080px 초과 영상에 프록시 제안, 생성(진행률, 편집 계속 가능), 미리보기에만 사용 / _요구사항: R12_
- **11. ffmpeg.wasm 대체 경로 — 2단계로 이동.** 1단계에서는 WebCodecs를 쓸 수 없는 환경에 안내 화면(R1.3, 태스크 2)만 보여 준다. / _요구사항: R11.4_
