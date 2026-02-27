"use client";

import { useEffect, useState } from "react";
import ItineraryView from "@/components/ItineraryView";
import LoadingSpinner from "@/components/LoadingSpinner";
import type { StoredItinerary } from "@/lib/types";

export default function SharePage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<StoredItinerary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = params?.id;
    if (!id) return;
    fetch(`/api/share/${id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          setError("일정을 찾을 수 없습니다.");
          return;
        }
        const item = json.itinerary;
        if (!item?.markdown || !item?.payload) {
          setError("일정을 불러오지 못했습니다.");
          return;
        }
        const next: StoredItinerary = {
          markdown: item.markdown,
          payload: item.payload,
          generatedAt: new Date().toISOString(),
        };
        setData(next);
      })
      .catch(() => setError("일정을 불러오지 못했습니다."));
  }, [params]);

  if (error) {
    return (
      <main className="min-h-screen bg-grid px-4 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-md rounded-3xl border border-white/20 bg-white/90 p-8 text-center shadow-xl backdrop-blur">
          <h2 className="text-xl font-bold text-slate-900">공유 일정 오류</h2>
          <p className="mt-2 text-slate-600">{error}</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-grid px-4 py-12 sm:px-6 sm:py-14">
        <LoadingSpinner message="공유 일정을 불러오고 있습니다..." />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-grid px-4 py-10 sm:px-6 sm:py-14">
      <ItineraryView data={data} />
    </main>
  );
}
