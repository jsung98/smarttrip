"use client";

import { useAuth } from "@/components/AuthProvider";

export default function AuthStatus() {
  const auth = useAuth();

  if (auth.status === "loading") {
    return <div className="text-sm text-slate-500">로그인 상태 확인 중...</div>;
  }

  if (auth.status === "authenticated") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-white/60 bg-white/85 px-4 py-3 shadow-sm">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{auth.user.name}</p>
          <p className="text-xs text-slate-500">카카오 로그인됨 · 내 일정 저장 가능</p>
        </div>
        <button
          type="button"
          onClick={() => void auth.logout()}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
        >
          로그아웃
        </button>
      </div>
    );
  }

  return (
    <a
      href={auth.loginHref}
      className="inline-flex items-center rounded-2xl bg-[#FEE500] px-4 py-3 text-sm font-semibold text-[#3A1D1D] shadow-sm transition hover:brightness-95"
    >
      카카오로 로그인
    </a>
  );
}
