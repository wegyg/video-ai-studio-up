import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { generatePlan } from "@/pipeline";
import type { AspectRatio, CaptionStyle } from "@/schema";
import { jobDir } from "@/server/jobs";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/plan
 * multipart form: brief, ratio, duration, 0+ `videos`.
 * Uploads footage into a plan dir and returns an EDITABLE plan (no render).
 * The planId lets /api/render reuse the same uploaded footage.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const brief = String(form.get("brief") ?? "").trim();
  const reference = String(form.get("reference") ?? "").trim();
  const ratio = (String(form.get("ratio") ?? "9:16") as AspectRatio) || "9:16";
  const duration = Number(form.get("duration") ?? 20) || 20;
  const captionStyle = form.get("caption_style")
    ? (String(form.get("caption_style")) as CaptionStyle)
    : undefined;
  if (!brief) return NextResponse.json({ error: "한 줄 설명을 입력해 주세요." }, { status: 400 });

  const planId = crypto.randomUUID().slice(0, 12);
  const dir = jobDir(planId);
  fs.mkdirSync(dir, { recursive: true });

  const files = form.getAll("videos").filter((f): f is File => f instanceof File);
  const clipPaths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const ext = path.extname(files[i].name) || ".mp4";
    const dest = path.join(dir, `clip_${i}${ext}`);
    fs.writeFileSync(dest, Buffer.from(await files[i].arrayBuffer()));
    clipPaths.push(dest);
  }

  try {
    const { plan, validation } = await generatePlan({
      brief,
      reference,
      clipPaths,
      ratio,
      durationSec: duration,
      captionStyle,
    });
    return NextResponse.json({
      planId,
      plan,
      issues: validation.issues,
      ok: validation.ok,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
