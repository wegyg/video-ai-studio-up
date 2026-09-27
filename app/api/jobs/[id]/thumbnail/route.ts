import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { jobStore } from "@/server/jobs";

export const runtime = "nodejs";

/** GET /api/jobs/:id/thumbnail -> the generated thumbnail PNG. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const job = jobStore.get(params.id);
  if (!job || !job.thumbnailPath || !fs.existsSync(job.thumbnailPath)) {
    return NextResponse.json({ error: "Thumbnail not ready" }, { status: 404 });
  }
  const data = fs.readFileSync(job.thumbnailPath);
  return new NextResponse(data, {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="thumb_${job.id}.png"`,
      "Content-Length": String(data.length),
    },
  });
}
