import { NextRequest, NextResponse } from "next/server";
import { extractBrief } from "@/brief";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST /api/brief  { reference } -> { brief } editable brief card. */
export async function POST(req: NextRequest) {
  let body: { reference?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!body.reference || !body.reference.trim()) {
    return NextResponse.json({ error: "참고 자료를 입력해 주세요." }, { status: 400 });
  }
  const brief = await extractBrief(body.reference);
  return NextResponse.json({ brief });
}
