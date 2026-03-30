import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, createAuthSession } from "@/lib/auth/session";
import { exchangeKakaoCode, fetchKakaoUser } from "@/lib/kakaoAuth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/?login_error=${encodeURIComponent(error)}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/?login_error=missing_code", request.url));
  }

  try {
    const accessToken = await exchangeKakaoCode(code);
    const user = await fetchKakaoUser(accessToken);
    const session = createAuthSession(user);

    if (!session) {
      return NextResponse.redirect(new URL("/?login_error=session_not_configured", request.url));
    }

    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: session,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    return response;
  } catch (err) {
    console.error("Kakao callback error:", err);
    return NextResponse.redirect(new URL("/?login_error=callback_failed", request.url));
  }
}
