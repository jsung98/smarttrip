import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest, importUserTrips } from "@/lib/server/trips";

export async function POST(request: NextRequest) {
  const user = getAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { trips?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (!Array.isArray(body?.trips)) {
    return NextResponse.json({ error: "가져올 일정이 없습니다." }, { status: 400 });
  }

  try {
    const result = await importUserTrips(user.id, body.trips as any[]);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Trip import error:", err);
    return NextResponse.json({ error: "로컬 일정을 가져오지 못했습니다." }, { status: 500 });
  }
}
