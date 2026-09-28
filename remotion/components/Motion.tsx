import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { Motion as MotionSchema } from "../../src/schema";

const FONT = '"Noto Sans KR", "Noto Sans CJK KR", "Noto Sans", system-ui, sans-serif';

/**
 * Overlay motion-graphic for a scene. Each preset draws animated graphics
 * on top of the background. All purely CSS/SVG — no external assets.
 */
export const MotionOverlay: React.FC<{
  motion: MotionSchema;
  accent?: string;
}> = ({ motion, accent = "#ff5252" }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { type, params } = motion;

  if (type === "none") return null;

  const s = spring({ frame, fps, config: { damping: 12, stiffness: 160, mass: 0.7 }, durationInFrames: 18 });

  if (type === "zoom_punch") {
    const scale = interpolate(frame, [0, 8, 14], [1.2, 0.98, 1.0], { extrapolateRight: "clamp" });
    return (
      <AbsoluteFill style={{ transform: `scale(${scale})`, pointerEvents: "none" }} />
    );
  }

  if (type === "circle_highlight") {
    const x = (params.x ?? 0.5) * 100;
    const y = (params.y ?? 0.6) * 100;
    const r = interpolate(s, [0, 1], [0, 80]);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            left: `${x}%`,
            top: `${y}%`,
            width: r,
            height: r,
            marginLeft: -r / 2,
            marginTop: -r / 2,
            borderRadius: "50%",
            border: `3px solid ${accent}`,
            boxShadow: `0 0 20px ${accent}60`,
            opacity: interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        />
      </AbsoluteFill>
    );
  }

  if (type === "arrow_highlight") {
    const x = (params.x ?? 0.5) * 100;
    const y = (params.y ?? 0.5) * 100;
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            left: `${x}%`,
            top: `${y}%`,
            transform: `translateY(${(1 - s) * 30}px)`,
            opacity: s,
            fontSize: 48,
            color: accent,
            filter: `drop-shadow(0 2px 6px ${accent}80)`,
          }}
        >
          ▼
        </div>
      </AbsoluteFill>
    );
  }

  if (type === "text_popup") {
    const label = String(params.text ?? "");
    return (
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            transform: `scale(${s}) translateY(${(1 - s) * 20}px)`,
            opacity: s,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 72,
            color: "#fff",
            textShadow: `0 4px 18px ${accent}90`,
            background: `linear-gradient(135deg, ${accent}22, ${accent}08)`,
            borderRadius: 24,
            padding: "12px 40px",
            border: `2px solid ${accent}40`,
          }}
        >
          {label}
        </div>
      </AbsoluteFill>
    );
  }

  if (type === "before_after_split") {
    const split = interpolate(frame, [6, durationInFrames - 6], [0, 100], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            left: `${split}%`,
            top: 0,
            bottom: 0,
            width: 4,
            background: accent,
            boxShadow: `0 0 12px ${accent}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 20,
            top: "45%",
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 32,
            color: "#fff",
            opacity: split < 30 ? 1 : 0,
          }}
        >
          BEFORE
        </div>
        <div
          style={{
            position: "absolute",
            right: 20,
            top: "45%",
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 32,
            color: accent,
            opacity: split > 70 ? 1 : 0,
          }}
        >
          AFTER
        </div>
      </AbsoluteFill>
    );
  }

  if (type === "number_countup") {
    const from = Number(params.from ?? 0);
    const to = Number(params.to ?? 100);
    const suffix = String(params.suffix ?? "");
    const val = Math.round(interpolate(frame, [0, durationInFrames * 0.7], [from, to], {
      extrapolateRight: "clamp",
    }));
    return (
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: 120,
            color: accent,
            textShadow: "0 4px 16px rgba(0,0,0,0.5)",
            transform: `scale(${s})`,
          }}
        >
          {val}
          <span style={{ fontSize: 56 }}>{suffix}</span>
        </div>
      </AbsoluteFill>
    );
  }

  if (type === "ending_cta_card") {
    const btnText = String(params.button ?? "Click");
    return (
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          background: "rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            transform: `scale(${s}) translateY(${(1 - s) * 30}px)`,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 44,
            color: "#fff",
            textAlign: "center",
            padding: "0 10%",
            marginBottom: 28,
          }}
        >
          {btnText}
        </div>
        <div
          style={{
            transform: `scale(${s})`,
            background: accent,
            color: "#fff",
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 28,
            borderRadius: 40,
            padding: "14px 48px",
            boxShadow: `0 6px 24px ${accent}60`,
          }}
        >
          ▶ {btnText}
        </div>
      </AbsoluteFill>
    );
  }

  return null;
};
