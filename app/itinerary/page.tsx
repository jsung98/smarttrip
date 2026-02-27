"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ItineraryView from "@/components/ItineraryView";
import LoadingSpinner from "@/components/LoadingSpinner";
import type { StoredItinerary } from "@/lib/types";

export default function ItineraryPage() {
  const [data, setData] = useState<StoredItinerary | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem("smart-trip-itinerary");
      if (raw) setData(JSON.parse(raw) as StoredItinerary);
    } catch {
      setData(null);
    }
  }, [mounted]);

  if (!mounted) {
    return (
      <main className="min-h-screen bg-grid px-4 py-12 sm:px-6 sm:py-14">
        <LoadingSpinner message="일정을 찾고 있습니다..." />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-grid px-4 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-md rounded-3xl border border-white/20 bg-white/90 p-8 text-center shadow-xl backdrop-blur">
          <h2 className="text-xl font-bold text-slate-900">아직 일정이 없어요</h2>
          <p className="mt-2 text-slate-600">
            메인에서 일정을 만들면 여기에서 볼 수 있어요.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2.5 font-semibold text-white shadow-lg transition hover:from-violet-700 hover:to-fuchsia-700"
          >
            여행 일정 만들기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-grid px-4 py-10 sm:px-6 sm:py-14">
      <ItineraryView data={data} />
    </main>
  );
}
