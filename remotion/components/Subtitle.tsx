import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

const FONT = '"Noto Sans CJK KR", "Noto Sans KR", "Noto Sans", system-ui, sans-serif';

/**
 * CapCut-style animated subtitle: words pop in one-by-one; the emphasis word is
 * shown in the accent color. Positions are stable (whole caption is laid out at
 * once) so nothing shifts as words appear.
 */
export const Subtitle: React.FC<{
  text: string;
  emphasis?: string;
  accent?: string;
  fontSize?: number;
}> = ({ text, emphasis = "", accent = "#ff5252", fontSize = 64 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!text.trim()) return null;

  const words = text.split(/\s+/);
  const perWord = 4; // frames between each word appearing

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "18%",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "0.28em",
        padding: "0 8%",
        fontFamily: FONT,
        fontWeight: 800,
        fontSize,
        lineHeight: 1.25,
      }}
    >
      {words.map((w, i) => {
        const appear = i * perWord;
        const s = spring({
          frame: frame - appear,
          fps,
          config: { damping: 14, stiffness: 180, mass: 0.6 },
          durationInFrames: 12,
        });
        const opacity = interpolate(frame - appear, [0, 3], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const isEmph = emphasis && w.replace(/[.,!?]/g, "").includes(emphasis);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `scale(${0.6 + s * 0.4}) translateY(${(1 - s) * 12}px)`,
              opacity,
              color: isEmph ? accent : "#fff",
              WebkitTextStroke: "2px rgba(0,0,0,0.55)",
              textShadow: "0 3px 10px rgba(0,0,0,0.6)",
              background: "rgba(10,10,15,0.42)",
              borderRadius: 14,
              padding: "0.04em 0.22em",
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};
