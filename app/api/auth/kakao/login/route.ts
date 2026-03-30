import { NextResponse } from "next/server";
import { getKakaoAuthorizeUrl } from "@/lib/kakaoAuth";

export async function GET() {
  const url = getKakaoAuthorizeUrl();
  if (!url) {
    return NextResponse.json(
      { error: "카카오 로그인 환경 변수가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  return NextResponse.redirect(url);
}
