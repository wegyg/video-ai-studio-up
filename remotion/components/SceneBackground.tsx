import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, interpolate } from "remotion";

/**
 * Scene background. If a real source clip is available (a public/ file), it is
 * shown as video; otherwise a deterministic gradient placeholder is drawn from
 * the clip name so preview renders work with NO footage (API-free).
 */
export const SceneBackground: React.FC<{
  sourceClip: string;
  clipSrc?: string | null; // resolved path under public/, if the footage exists
  kenBurns?: boolean;
  durationInFrames: number;
}> = ({ sourceClip, clipSrc, kenBurns = true, durationInFrames }) => {
  const frame = useCurrentFrame();

  if (clipSrc) {
    const scale = kenBurns
      ? interpolate(frame, [0, durationInFrames], [1.0, 1.08], {
          extrapolateRight: "clamp",
        })
      : 1;
    return (
      <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
        <OffthreadVideo
          src={clipSrc}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale})`,
          }}
        />
      </AbsoluteFill>
    );
  }

  // --- Placeholder gradient (deterministic from clip name) ---
  const [c1, c2] = gradientFor(sourceClip);
  const scale = kenBurns
    ? interpolate(frame, [0, durationInFrames], [1.0, 1.06], { extrapolateRight: "clamp" })
    : 1;
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${c1} 0%, ${c2} 100%)`,
        transform: `scale(${scale})`,
      }}
    >
      <AbsoluteFill
        style={{
          background: "radial-gradient(120% 80% at 50% 20%, rgba(255,255,255,0.10), transparent 60%)",
        }}
      />
    </AbsoluteFill>
  );
};

function gradientFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return [`hsl(${hue}, 55%, 42%)`, `hsl(${(hue + 30) % 360}, 45%, 20%)`];
}
