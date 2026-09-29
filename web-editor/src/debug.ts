/** 테스트용 창구: window.__editor. 편집기 내부 상태를 읽기 전용으로 노출한다. */
import type { EditorDebugApi } from './debug-types';
import { detectSupport } from './support';

export const debugApi: EditorDebugApi = {
  version: '0.1.0',
  support: async () => ({ ...(await detectSupport()) }),
  // 스파이크 코드는 테스트에서만 필요하므로 별도 청크로 나눠 필요할 때만 불러온다.
  spike: async (video: Blob) => (await import('./dev/spike')).runSpike(video),
};

export function installDebugApi(): void {
  window.__editor = debugApi;
}
