/**
 * Run the full pipeline from the command line (API-free).
 * Usage:
 *   npx tsx scripts/generate.ts "<one-line brief>" [out.mp4] [clip1 clip2 ...]
 */
import { runPipeline } from "../src/pipeline";
import { formatIssues } from "../src/validate";

async function main() {
  const [brief, out, ...clips] = process.argv.slice(2);
  if (!brief) {
    console.error('Usage: tsx scripts/generate.ts "<brief>" [out.mp4] [clips...]');
    process.exit(1);
  }
  const res = await runPipeline(
    { brief, clipPaths: clips, outPath: out ?? "out/output.mp4" },
    { onProgress: (stage, detail) => console.log(`[${stage}]${detail ? " " + detail : ""}`) },
  );
  console.log("\n=== validation ===");
  console.log("ok:", res.validation.ok);
  console.log(formatIssues(res.validation.issues));
  console.log("\n=== plan summary ===");
  console.log("scenes:", res.plan.timeline.length, "duration:", res.plan.format.duration_sec + "s");
  res.plan.timeline.forEach((s, i) =>
    console.log(`  ${i}: [${s.start}-${s.end}s] ${s.motion.type}  "${s.subtitle}"`),
  );
  console.log("\n✅ output:", res.outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
