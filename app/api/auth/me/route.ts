import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/server/trips";

export async function GET(request: NextRequest) {
  const user = getAuthUserFromRequest(request);
  return NextResponse.json({ user });
}
