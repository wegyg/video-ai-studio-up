import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { CaptionStyle } from "../../src/schema";

const FONT = '"Noto Sans KR", "Noto Sans CJK KR", "Noto Sans", system-ui, sans-serif';

interface Props {
  text: string;
  emphasis?: string;
  accent?: string;
  fontSize?: number;
  style?: CaptionStyle;
}

const isEmphWord = (w: string, emphasis: string) =>
  Boolean(emphasis) && w.replace(/[.,!?]/g, "").includes(emphasis);

/**
 * Animated subtitle with selectable style presets:
 * - bold-pop:    words pop in one-by-one on dark chips (energetic; default)
 * - karaoke-bar: full line shown, a highlight sweeps word-by-word
 * - minimal:     clean thin text, subtle fade in, no chips
 * - boxed:       one solid lower-third box with the whole line
 * Positions are laid out from the full line so nothing shifts as words appear.
 */
export const Subtitle: React.FC<Props> = ({
  text,
  emphasis = "",
  accent = "#ff5252",
  fontSize = 64,
  style = "bold-pop",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!text.trim()) return null;
  const words = text.split(/\s+/);

  if (style === "boxed") return <Boxed text={text} accent={accent} fontSize={fontSize} frame={frame} fps={fps} />;
  if (style === "minimal")
    return <Minimal words={words} emphasis={emphasis} accent={accent} fontSize={fontSize} frame={frame} />;
  if (style === "karaoke-bar")
    return (
      <Karaoke words={words} emphasis={emphasis} accent={accent} fontSize={fontSize} frame={frame} fps={fps} />
    );
  return <BoldPop words={words} emphasis={emphasis} accent={accent} fontSize={fontSize} frame={frame} fps={fps} />;
};

const wrap = (justify = "center"): React.CSSProperties => ({
  position: "absolute",
  left: 0,
  right: 0,
  bottom: "18%",
  display: "flex",
  flexWrap: "wrap",
  justifyContent: justify as React.CSSProperties["justifyContent"],
  gap: "0.28em",
  padding: "0 8%",
  fontFamily: FONT,
  lineHeight: 1.25,
});

// --- bold-pop (default) ----------------------------------------------------
const BoldPop: React.FC<{
  words: string[]; emphasis: string; accent: string; fontSize: number; frame: number; fps: number;
}> = ({ words, emphasis, accent, fontSize, frame, fps }) => {
  const perWord = 4;
  return (
    <div style={{ ...wrap(), fontWeight: 800, fontSize }}>
      {words.map((w, i) => {
        const s = spring({ frame: frame - i * perWord, fps, config: { damping: 14, stiffness: 180, mass: 0.6 }, durationInFrames: 12 });
        const opacity = interpolate(frame - i * perWord, [0, 3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <span key={i} style={{
            display: "inline-block",
            transform: `scale(${0.6 + s * 0.4}) translateY(${(1 - s) * 12}px)`,
            opacity,
            color: isEmphWord(w, emphasis) ? accent : "#fff",
            WebkitTextStroke: "2px rgba(0,0,0,0.55)",
            textShadow: "0 3px 10px rgba(0,0,0,0.6)",
            background: "rgba(10,10,15,0.42)",
            borderRadius: 14,
            padding: "0.04em 0.22em",
          }}>{w}</span>
        );
      })}
    </div>
  );
};

// --- karaoke-bar -----------------------------------------------------------
const Karaoke: React.FC<{
  words: string[]; emphasis: string; accent: string; fontSize: number; frame: number; fps: number;
}> = ({ words, emphasis, accent, fontSize, frame }) => {
  const per = 8; // frames per word highlight
  const activeIdx = Math.min(words.length - 1, Math.floor(frame / per));
  return (
    <div style={{ ...wrap(), fontWeight: 800, fontSize }}>
      {words.map((w, i) => {
        const active = i <= activeIdx;
        return (
          <span key={i} style={{
            display: "inline-block",
            color: active ? "#fff" : "rgba(255,255,255,0.55)",
            background: i === activeIdx ? accent : "rgba(10,10,15,0.5)",
            WebkitTextStroke: "1.5px rgba(0,0,0,0.5)",
            textShadow: "0 2px 8px rgba(0,0,0,0.6)",
            borderRadius: 10,
            padding: "0.04em 0.22em",
            transition: "none",
          }}>{w}</span>
        );
      })}
    </div>
  );
};

// --- minimal ---------------------------------------------------------------
const Minimal: React.FC<{
  words: string[]; emphasis: string; accent: string; fontSize: number; frame: number;
}> = ({ words, emphasis, accent, fontSize, frame }) => {
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(frame, [0, 10], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ ...wrap(), fontWeight: 600, fontSize: fontSize * 0.92, gap: "0.3em", opacity, transform: `translateY(${y}px)` }}>
      {words.map((w, i) => (
        <span key={i} style={{
          color: isEmphWord(w, emphasis) ? accent : "#fff",
          textShadow: "0 2px 14px rgba(0,0,0,0.85)",
        }}>{w}</span>
      ))}
    </div>
  );
};

// --- boxed (lower third) ---------------------------------------------------
const Boxed: React.FC<{
  text: string; accent: string; fontSize: number; frame: number; fps: number;
}> = ({ text, accent, fontSize, frame, fps }) => {
  const s = spring({ frame, fps, config: { damping: 16, stiffness: 160, mass: 0.7 }, durationInFrames: 14 });
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, bottom: "16%",
      display: "flex", justifyContent: "center", padding: "0 6%",
    }}>
      <div style={{
        transform: `translateY(${(1 - s) * 24}px)`,
        opacity: s,
        fontFamily: FONT,
        fontWeight: 800,
        fontSize: fontSize * 0.9,
        color: "#fff",
        background: "rgba(10,10,15,0.82)",
        borderLeft: `10px solid ${accent}`,
        borderRadius: 12,
        padding: "0.4em 0.7em",
        textAlign: "center",
        boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
        maxWidth: "88%",
      }}>{text}</div>
    </div>
  );
};
