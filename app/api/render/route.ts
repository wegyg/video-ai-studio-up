import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { renderPlan } from "@/pipeline";
import { parseEditPlan } from "@/schema";
import type { SourceClipInfo } from "@/providers/types";
import { probeClip } from "@/probe";
import { jobStore, jobDir } from "@/server/jobs";
import { renderQueue } from "@/server/queue";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/render  (JSON body: { planId, plan })
 * Renders a (possibly edited) plan, reusing footage staged during /api/plan.
 * Returns { id } to poll via /api/jobs/:id.
 */
export async function POST(req: NextRequest) {
  let body: { planId?: string; plan?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseEditPlan(body.plan);
  if (!parsed.timeline.length) {
    return NextResponse.json({ error: "Plan has no scenes" }, { status: 400 });
  }

  // Reuse footage uploaded during /api/plan (if any).
  const clips: SourceClipInfo[] = [];
  if (body.planId) {
    const planDir = jobDir(body.planId);
    if (fs.existsSync(planDir)) {
      const clipFiles = fs
        .readdirSync(planDir)
        .filter((f) => f.startsWith("clip_"))
        .sort();
      for (let i = 0; i < clipFiles.length; i++) {
        const p = path.join(planDir, clipFiles[i]);
        const meta = await probeClip(p);
        clips.push({ id: `clip_${i}`, path: p, ...meta });
      }
    }
  }

  const id = crypto.randomUUID().slice(0, 12);
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });
  jobStore.create(id);
  const outPath = path.join(dir, "output.mp4");

  renderQueue.enqueue({
    id,
    onQueued: (position) => jobStore.markQueued(id, position),
    run: () =>
      renderPlan(parsed, clips, {
        outPath,
        log: (stage, detail) => jobStore.markStage(id, stage, detail),
      })
        .then((res) => {
          jobStore.markDone(
            id,
            res.outPath,
            { scenes: res.plan.timeline.length, duration: res.plan.format.duration_sec },
            res.thumbnailPath,
          );
        })
        .catch((e: unknown) => {
          jobStore.markError(id, e instanceof Error ? e.message : String(e));
        }),
  });

  return NextResponse.json({ id });
}
