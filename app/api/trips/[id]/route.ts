import { NextRequest, NextResponse } from "next/server";
import { deleteUserTrip, getAuthUserFromRequest, getUserTrip, updateUserTrip } from "@/lib/server/trips";

type Params = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Params) {
  const user = getAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    const item = await getUserTrip(user.id, params.id);
    if (!item) {
      return NextResponse.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (err) {
    console.error("Trip load error:", err);
    return NextResponse.json({ error: "일정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
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
    const result = await updateUserTrip(user.id, params.id, body.snapshot as any, body.document as any);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Trip update error:", err);
    return NextResponse.json({ error: "일정 저장에 실패했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = getAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    await deleteUserTrip(user.id, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Trip delete error:", err);
    return NextResponse.json({ error: "일정을 삭제하지 못했습니다." }, { status: 500 });
  }
}
