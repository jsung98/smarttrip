"use client";

import Script from "next/script";

type KakaoSdkScriptProps = {
  kakaoKey: string;
  kakaoVersion: string;
  kakaoIntegrity?: string;
};

export default function KakaoSdkScript({
  kakaoKey,
  kakaoVersion,
  kakaoIntegrity,
}: KakaoSdkScriptProps) {
  return (
    <Script
      src={`https://t1.kakaocdn.net/kakao_js_sdk/${kakaoVersion}/kakao.min.js`}
      integrity={kakaoIntegrity || undefined}
      crossOrigin="anonymous"
      strategy="afterInteractive"
      onLoad={() => {
        const Kakao = (window as any).Kakao;
        if (Kakao && !Kakao.isInitialized()) {
          Kakao.init(kakaoKey);
        }
      }}
    />
  );
}
