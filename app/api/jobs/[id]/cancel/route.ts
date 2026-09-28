import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/server/jobs";

export const runtime = "nodejs";

/** POST /api/jobs/:id/cancel — mark the job cancelled (stops UI polling). */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ok = jobStore.cancel(params.id);
  return NextResponse.json({ ok });
}
