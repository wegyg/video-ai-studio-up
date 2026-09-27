import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { jobStore } from "@/server/jobs";

export const runtime = "nodejs";

/** GET /api/jobs/:id/video -> the rendered MP4 (streamed). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const job = jobStore.get(params.id);
  if (!job || !job.outPath || !fs.existsSync(job.outPath)) {
    return NextResponse.json({ error: "Video not ready" }, { status: 404 });
  }
  const data = fs.readFileSync(job.outPath);
  return new NextResponse(data, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `inline; filename="short_${job.id}.mp4"`,
      "Content-Length": String(data.length),
    },
  });
}
