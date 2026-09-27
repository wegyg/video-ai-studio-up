/**
 * Render the sample edit-plan to an MP4 with NO external APIs.
 * Usage: npx tsx scripts/render-sample.ts [outPath]
 */
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { parseEditPlan } from "../src/schema";
import { samplePlan } from "../src/fixtures/sample-plan";

async function main() {
  const out = process.argv[2] ?? path.resolve("out/sample.mp4");
  const plan = parseEditPlan(samplePlan);

  console.log("Bundling Remotion project…");
  const serveUrl = await bundle({
    entryPoint: path.resolve("remotion/index.ts"),
    // keep webpack default; no custom config needed
  });

  console.log("Selecting composition…");
  const composition = await selectComposition({
    serveUrl,
    id: "Plan",
    inputProps: { plan },
  });

  console.log(
    `Rendering ${composition.width}x${composition.height} @ ${composition.fps}fps, ` +
      `${composition.durationInFrames} frames -> ${out}`,
  );
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: out,
    inputProps: { plan },
    concurrency: 2,
  });

  console.log("✅ Rendered:", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
