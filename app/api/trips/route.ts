import { NextRequest, NextResponse } from "next/server";
import { listUserTrips, saveUserTrip, getAuthUserFromRequest } from "@/lib/server/trips";

export async function GET(request: NextRequest) {
  const user = getAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    const items = await listUserTrips(user.id);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("Trips list error:", err);
    return NextResponse.json({ error: "내 일정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = getAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { snapshot?: unknown; document?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (!body?.snapshot) {
    return NextResponse.json({ error: "저장할 일정이 없습니다." }, { status: 400 });
  }

  try {
    const result = await saveUserTrip(user.id, body.snapshot as any, body.document as any);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Trip save error:", err);
    return NextResponse.json({ error: "일정 저장에 실패했습니다." }, { status: 500 });
  }
}
