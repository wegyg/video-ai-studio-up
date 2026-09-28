import React from "react";
import { AbsoluteFill } from "remotion";
import type { EditPlan } from "../src/schema";
import { ensureKoreanFont } from "./fonts";

const FONT = '"Noto Sans KR", "Noto Sans CJK KR", "Noto Sans", system-ui, sans-serif';
const ACCENT = "#ff5252";

/**
 * A single still thumbnail: the hook scene's background style + a bold, legible
 * headline from plan.thumbnail_text (or the hook subtitle). Rendered by
 * Remotion (perfect font/CJK support), exported as PNG via renderStill.
 */
export const Thumbnail: React.FC<{ plan: EditPlan }> = ({ plan }) => {
  ensureKoreanFont();
  const hook = plan.timeline[0];
  const headline = (plan.thumbnail_text || hook?.subtitle || "").trim();
  const seed = hook?.source_clip ?? "thumb";
  const [c1, c2] = gradientFor(seed);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* backdrop */}
      <AbsoluteFill style={{ background: `linear-gradient(160deg, ${c1} 0%, ${c2} 100%)` }} />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 80% at 50% 15%, rgba(255,255,255,0.12), transparent 60%)",
        }}
      />
      {/* darken bottom for text legibility */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.72) 100%)",
        }}
      />
      {/* headline */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "0 8% 12% 8%",
        }}
      >
        <div style={{ width: 90, height: 10, borderRadius: 6, background: ACCENT, marginBottom: 28 }} />
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: 96,
            lineHeight: 1.12,
            color: "#fff",
            textShadow: "0 6px 24px rgba(0,0,0,0.6)",
            WebkitTextStroke: "1px rgba(0,0,0,0.25)",
          }}
        >
          {headline}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

function gradientFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return [`hsl(${hue}, 60%, 40%)`, `hsl(${(hue + 28) % 360}, 50%, 16%)`];
}
