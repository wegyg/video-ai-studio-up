import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { runPipeline } from "@/pipeline";
import type { AspectRatio } from "@/schema";
import { jobStore, jobDir } from "@/server/jobs";

export const runtime = "nodejs";
export const maxDuration = 300; // allow long renders

/**
 * POST /api/generate
 * multipart form: brief (string), ratio, duration, and 0+ `videos` files.
 * Saves uploads, kicks off the pipeline in the background, returns { id }.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const brief = String(form.get("brief") ?? "").trim();
  const ratio = (String(form.get("ratio") ?? "9:16") as AspectRatio) || "9:16";
  const duration = Number(form.get("duration") ?? 20) || 20;

  if (!brief) {
    return NextResponse.json({ error: "A one-line brief is required" }, { status: 400 });
  }

  const id = crypto.randomUUID().slice(0, 12);
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });

  // Save uploaded footage (optional).
  const files = form.getAll("videos").filter((f): f is File => f instanceof File);
  const clipPaths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ext = path.extname(f.name) || ".mp4";
    const dest = path.join(dir, `clip_${i}${ext}`);
    const buf = Buffer.from(await f.arrayBuffer());
    fs.writeFileSync(dest, buf);
    clipPaths.push(dest);
  }

  jobStore.create(id);
  const outPath = path.join(dir, "output.mp4");

  // Run the pipeline in the background; the client polls /api/jobs/:id.
  void runPipeline(
    { brief, clipPaths, ratio, durationSec: duration, outPath },
    { onProgress: (stage, detail) => jobStore.markStage(id, stage, detail) },
  )
    .then((res) => {
      jobStore.markDone(id, res.outPath, {
        scenes: res.plan.timeline.length,
        duration: res.plan.format.duration_sec,
      });
    })
    .catch((e: unknown) => {
      jobStore.markError(id, e instanceof Error ? e.message : String(e));
    });

  return NextResponse.json({ id });
}
