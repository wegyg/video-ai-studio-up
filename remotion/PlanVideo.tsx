import React from "react";
import { AbsoluteFill, Sequence, staticFile, useVideoConfig } from "remotion";
import type { EditPlan } from "../src/schema";
import { SceneBackground } from "./components/SceneBackground";
import { Subtitle } from "./components/Subtitle";
import { MotionOverlay } from "./components/Motion";

const ACCENT = "#ff5252";

/**
 * Renders a full EditPlan: each scene is a Sequence placed on the timeline at
 * its start/end (converted to frames), stacking background + motion + subtitle.
 * `clipSrcMap` maps a source_clip id to a public/ file name (staged uploaded
 * footage); missing ids fall back to a placeholder background.
 */
export const PlanVideo: React.FC<{
  plan: EditPlan;
  clipSrcMap?: Record<string, string>;
  /**
   * "full": draw background + overlays (used for placeholder/no-footage or when
   *   the environment can decode video in Remotion).
   * "overlay": transparent background, ONLY captions + motion graphics. The
   *   uploaded footage is composited underneath by FFmpeg afterwards. This path
   *   avoids Remotion's video compositor (which needs newer GLIBC).
   */
  mode?: "full" | "overlay";
}> = ({ plan, clipSrcMap = {}, mode = "full" }) => {
  const { fps } = useVideoConfig();
  const overlayOnly = mode === "overlay";

  return (
    <AbsoluteFill style={{ backgroundColor: overlayOnly ? "transparent" : "#000" }}>
      {plan.timeline.map((scene, i) => {
        const from = Math.round(scene.start * fps);
        const durationInFrames = Math.max(1, Math.round((scene.end - scene.start) * fps));
        const staged = clipSrcMap[scene.source_clip];
        const clipSrc = staged ? staticFile(staged) : null;
        return (
          <Sequence key={i} from={from} durationInFrames={durationInFrames} name={`scene-${i}`}>
            {!overlayOnly && (
              <SceneBackground
                sourceClip={scene.source_clip}
                clipSrc={clipSrc}
                durationInFrames={durationInFrames}
              />
            )}
            <MotionOverlay motion={scene.motion} accent={ACCENT} />
            <Subtitle
              text={scene.subtitle}
              emphasis={scene.subtitle_emphasis}
              accent={ACCENT}
              style={plan.format.caption_style}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
