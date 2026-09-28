/**
 * Register the bundled Korean font (Noto Sans KR) at MODULE scope so Hangul
 * renders on any OS with no system-font dependency. Importing this module runs
 * the registration exactly once and holds the render (delayRender) until the
 * fonts are actually loaded, so no frame is captured with fallback/tofu glyphs.
 */
import { staticFile, continueRender, delayRender } from "remotion";

// Only meaningful in the browser/render environment.
if (typeof document !== "undefined") {
  const handle = delayRender("load-korean-font");

  const face = (weight: number, file: string) => `
    @font-face {
      font-family: 'Noto Sans KR';
      font-weight: ${weight};
      font-display: block;
      src: url('${staticFile(file)}') format('woff2');
    }`;

  const style = document.createElement("style");
  style.textContent = [
    face(400, "fonts/NotoSansKR-Regular.woff2"),
    face(700, "fonts/NotoSansKR-Bold.woff2"),
    face(900, "fonts/NotoSansKR-Black.woff2"),
  ].join("\n");
  document.head.appendChild(style);

  const finish = () => continueRender(handle);
  // Explicitly load the weights we use, then wait for the font set to be ready.
  Promise.all([
    document.fonts.load("400 64px 'Noto Sans KR'", "가"),
    document.fonts.load("700 64px 'Noto Sans KR'", "가"),
    document.fonts.load("900 64px 'Noto Sans KR'", "가"),
  ])
    .then(() => document.fonts.ready)
    .then(finish)
    .catch(finish);
}

// Importing this module is the registration; keep a no-op for explicit calls.
export function ensureKoreanFont(): void {
  /* registration happens on import (module scope) */
}
