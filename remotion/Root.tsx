import React from "react";
import { Composition } from "remotion";
import { PlanVideo } from "./PlanVideo";
import { ratioToDimensions } from "./dimensions";
import { parseEditPlan, type EditPlan } from "../src/schema";
import { samplePlan } from "../src/fixtures/sample-plan";

// Default props come from the sample plan; overridden at render time via
// --props (a full EditPlan JSON).
const defaultPlan = parseEditPlan(samplePlan);

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Plan"
      component={PlanVideo as React.FC<Record<string, unknown>>}
      // Duration/dimensions are recomputed from the incoming plan.
      durationInFrames={Math.round(defaultPlan.format.duration_sec * defaultPlan.format.fps)}
      fps={defaultPlan.format.fps}
      width={ratioToDimensions(defaultPlan.format.ratio).width}
      height={ratioToDimensions(defaultPlan.format.ratio).height}
      defaultProps={{ plan: defaultPlan, clipSrcMap: {}, mode: "full" } as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as { plan: EditPlan; clipSrcMap?: Record<string, string>; mode?: string };
        const plan = parseEditPlan(p.plan);
        const { width, height } = ratioToDimensions(plan.format.ratio);
        return {
          durationInFrames: Math.round(plan.format.duration_sec * plan.format.fps),
          fps: plan.format.fps,
          width,
          height,
          props: {
            plan,
            clipSrcMap: p.clipSrcMap ?? {},
            mode: p.mode ?? "full",
          } as unknown as Record<string, unknown>,
        };
      }}
    />
  );
};
