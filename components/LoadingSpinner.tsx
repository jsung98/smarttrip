"use client";

type LoadingSpinnerProps = {
  message?: string;
  showProgress?: boolean;
};

export default function LoadingSpinner({
  message = "일정을 불러오는 중입니다...",
  showProgress = true,
}: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-16" role="status" aria-label="로딩 중">
      <div className="h-14 w-14 animate-spin rounded-full border-4 border-slate-200 border-t-violet-500" aria-hidden />
      <p className="text-sm font-medium text-slate-600">{message}</p>
      {showProgress && <div className="progress-indeterminate h-2 w-52 rounded-full" />}
    </div>
  );
}
