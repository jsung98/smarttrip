import { NextRequest, NextResponse } from "next/server";
import { getShareTtlDays, supabaseRequest } from "@/lib/supabaseServer";
import { getClientId, rateLimit } from "@/lib/rateLimit";

export async function POST(request: NextRequest) {
  const clientId = getClientId(request.headers);
  const limit = rateLimit(`share:create:${clientId}`, { windowMs: 60_000, max: 10 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 }
    );
  }

  let body: { markdown: string; payload: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (!body?.markdown || !body?.payload) {
    return NextResponse.json({ error: "공유할 데이터가 없습니다." }, { status: 400 });
  }

  try {
    const ttlDays = getShareTtlDays();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    const res = await supabaseRequest("/rest/v1/itineraries?select=id,expires_at,delete_token", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        markdown: body.markdown,
        payload: body.payload,
        expires_at: expiresAt,
      }),
    });

    const data = (await res.json()) as { id: string; expires_at: string; delete_token: string }[];
    const id = data[0]?.id;
    const returnedExpires = data[0]?.expires_at;
    if (!id) return NextResponse.json({ error: "공유 링크 생성에 실패했습니다." }, { status: 500 });

    return NextResponse.json({
      id,
      expiresAt: returnedExpires ?? expiresAt,
    });
  } catch (err) {
    console.error("Share API error:", err);
    return NextResponse.json({ error: "공유 링크 생성에 실패했습니다." }, { status: 500 });
  }
}


