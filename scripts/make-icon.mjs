/**
 * Generate the app icon (build/icon.ico + build/icon.png) from an inline SVG.
 * Rendered with @resvg/resvg-js, packed to .ico with png-to-ico. Run once:
 *   node scripts/make-icon.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";

const svg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#ff5252"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <!-- rounded square bg -->
  <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="0" y="0" width="512" height="256" rx="112" fill="url(#sheen)"/>
  <!-- 9:16 phone frame -->
  <rect x="176" y="96" width="160" height="288" rx="28" fill="#0d0a16" opacity="0.9"/>
  <rect x="176" y="96" width="160" height="288" rx="28" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="4"/>
  <!-- play triangle -->
  <path d="M232 190 L232 290 L318 240 Z" fill="#ffffff"/>
  <!-- caption bar -->
  <rect x="196" y="326" width="120" height="20" rx="10" fill="#ff5252"/>
  <rect x="210" y="352" width="92" height="12" rx="6" fill="#ffffff" opacity="0.7"/>
</svg>`;

const sizes = [256, 128, 64, 48, 32, 16];
const buildDir = path.resolve("build");
fs.mkdirSync(buildDir, { recursive: true });

function renderPng(size) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  return r.render().asPng();
}

// main 512 PNG (used by mac/linux builds too)
fs.writeFileSync(path.join(buildDir, "icon.png"), renderPng(512));

// multi-size ICO for Windows
const pngs = sizes.map(renderPng);
const ico = await pngToIco(pngs);
fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);

console.log("Wrote build/icon.png (512) and build/icon.ico (" + sizes.join(",") + ")");
