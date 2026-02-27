import type { Metadata } from "next";
import KakaoSdkScript from "@/components/KakaoSdkScript";
import "./globals.css";

export const metadata: Metadata = {
  title: "맞춤 여행 플래너",
  description: "AI로 만드는 날짜별 맞춤 여행 일정",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY;
  const kakaoVersion = process.env.NEXT_PUBLIC_KAKAO_SDK_VERSION || "2.7.9";
  const kakaoIntegrity = process.env.NEXT_PUBLIC_KAKAO_SDK_INTEGRITY;

  return (
    <html lang="ko">
      <head>
        {kakaoKey && (
          <KakaoSdkScript
            kakaoKey={kakaoKey}
            kakaoVersion={kakaoVersion}
            kakaoIntegrity={kakaoIntegrity}
          />
        )}
      </head>
      <body className="min-h-screen bg-slate-50 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
