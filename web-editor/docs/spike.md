# 태스크 0 스파이크 결과

테스트: `tests/e2e/spike.spec.ts` (결과 원본은 `test-results/…/spike.json`).
검사 항목: Mediabunny 디코딩(CanvasSink) → 1080×1920 30fps H.264 + AAC 인코딩(CanvasSource + AudioBufferSource) → 결과 다시 읽기 → 앱에 포함한 글꼴 로드.

## 결과

| 항목 | 샌드박스 (Linux, Chrome 154, 헤드리스, GPU 없음) | CI (ubuntu-latest, Chrome) |
|------|------------------------------|----------------------------|
| 보안 컨텍스트 / WebCodecs | ✓ / ✓ | 태스크 2.5에서 기록 |
| H.264 인코딩 1080×1920 30fps | ✓ (소프트웨어) | |
| H.264 인코딩, 하드웨어 선호 | ✗ (GPU 없음) | |
| AAC 네이티브 인코딩 | ✗ → WASM 확장 사용 | |
| H.264 mp4 디코딩 (Mediabunny) | ✓, 2.5초 픽셀 = 파랑 (0,14,253) | |
| 인코딩 속도 (단순 화면 60프레임) | 697ms = **86fps** | |
| 출력 MP4 | avc + aac, 1080×1920, 2.027초 | |
| 글꼴 (Pretendard, Noto Sans KR × 400/700/900) | 6개 모두 로드 | |
| File System Access API | ✓ (`showSaveFilePicker`) | |

## 결론과 설계 반영
- **1단계 경로는 Linux Chrome에서 그대로 동작한다.** H.264는 소프트웨어 인코더로 인코딩되고, AAC는 네이티브가 없어 `@mediabunny/aac-encoder`(WASM)로 대체된다. 이 확장은 약 1MB라 `canEncodeAudio('aac')`가 false일 때만 동적으로 불러온다. Windows Chrome은 OS 인코더(Media Foundation)를 써서 네이티브 AAC가 될 것으로 예상하지만, 샌드박스에서는 확인할 수 없다. 사용자 확인 2에서 확인한다.
- **출력 길이 2.027초:** 영상 트랙은 정확히 2초이고, AAC 인코더 패딩(약 1024샘플)이 전체 길이를 늘린다. A4의 "길이 ±1프레임" 검사는 **영상 트랙 길이**로 한다.
- **하드웨어 가속 옵션(문서 확인 완료):** `CanvasSource`의 설정 타입 `VideoEncodingConfig`에 `hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software'`가 있다(`mediabunny.d.ts`의 `VideoEncodingAdditionalOptions`). 태스크 10에서는 `canEncodeVideo('avc', { …, hardwareAcceleration: 'prefer-hardware' })`가 true면 하드웨어를, 아니면 `no-preference`를 쓴다.
- **zundo 실행 취소(문서·구현 확인 완료):** `temporal.getState()`에 `pause()`, `resume()`, `isTracking`, `undo(steps)`, `redo(steps)`, `clear()`가 있다. 옵션은 `partialize`, `limit`, `equality`, `handleSet`이다. 구현상 기록 중일 때 `setState`를 부르면 **바로 전 상태**(partialize 적용)를 pastStates에 넣는다. 그래서 드래그 한 번을 기록 1개로 만들려면 이렇게 한다: 누를 때 `before`를 저장하고 `pause()` → 드래그 중에는 자유롭게 갱신 → 뗄 때 `before`로 되돌린 뒤 `resume()` → 최종 상태를 한 번 set.
- **Mediabunny API 확인 방식:** 설치한 1.60.0의 `dist/mediabunny.d.ts`에서 시그니처를 확인했다. 트랙 메타데이터는 비동기 게터(`getDisplayWidth()`, `getCodec()`, `canDecode()`)를 쓴다. `BufferSource`는 DOM 타입과 이름이 겹치므로 별칭으로 import한다.
- **글꼴:** Pretendard는 npm `pretendard@1.3.9`의 static woff2를 쓴다. Noto Sans KR은 저장소에 있던 woff2를 복사했다. 둘 다 한글 음절 11,172자 전체와 ASCII를 포함하는 것을 fontTools로 확인했고, 라이선스는 SIL OFL 1.1이다(`src/assets/fonts/LICENSE-*.txt`).
