import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/server/jobs";

export const runtime = "nodejs";

/** GET /api/jobs/:id -> job status JSON. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const job = jobStore.get(params.id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    queuePosition: job.queuePosition,
    error: job.error,
    planSummary: job.planSummary,
    videoUrl: job.status === "done" ? `/api/jobs/${job.id}/video` : null,
    thumbnailUrl: job.status === "done" && job.thumbnailPath ? `/api/jobs/${job.id}/thumbnail` : null,
  });
}
