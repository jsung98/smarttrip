import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabaseServer";
import { getClientId, rateLimit } from "@/lib/rateLimit";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = getClientId(request.headers);
  const limit = rateLimit(`share:get:${clientId}`, { windowMs: 60_000, max: 60 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 }
    );
  }

  const id = params?.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const nowIso = new Date().toISOString();
    const res = await supabaseRequest(
      `/rest/v1/itineraries?id=eq.${encodeURIComponent(
        id
      )}&deleted_at=is.null&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(
        nowIso
      )})&select=id,markdown,payload,created_at,expires_at`,
      { method: "GET" }
    );

    const data = (await res.json()) as {
      id: string;
      markdown: string;
      payload: unknown;
      expires_at?: string | null;
    }[];
    const item = data[0];
    if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

    return NextResponse.json({ itinerary: item });
  } catch (err) {
    console.error("Share fetch error:", err);
    return NextResponse.json({ error: "조회에 실패했습니다." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = getClientId(request.headers);
  const limit = rateLimit(`share:delete:${clientId}`, { windowMs: 60_000, max: 20 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 }
    );
  }

  const id = params?.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const token = request.headers.get("x-delete-token");
  if (!token) return NextResponse.json({ error: "delete token required" }, { status: 401 });

  try {
    const res = await supabaseRequest(
      `/rest/v1/itineraries?id=eq.${encodeURIComponent(id)}&delete_token=eq.${encodeURIComponent(
        token
      )}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      }
    );

    const data = (await res.json()) as { id: string }[];
    if (!data.length) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Share delete error:", err);
    return NextResponse.json({ error: "삭제에 실패했습니다." }, { status: 500 });
  }
}
