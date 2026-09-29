import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' → 빌드 결과(dist/)를 어느 경로에 올려도 동작한다 (GitHub Pages 하위 경로 포함).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // @mediabunny/aac-encoder(WASM, 약 1MB)는 AAC 네이티브 인코더가 없을 때만 동적으로 불러오는 청크라 경고 기준을 올린다.
  build: { chunkSizeWarningLimit: 1100 },
  preview: { port: 4173, strictPort: true },
});
