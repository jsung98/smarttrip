"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getRecentItineraries,
  openRecentItinerary,
  removeRecentItinerary,
} from "@/lib/localItineraryStore";
import { normalizeTripPayload, type StoredItinerary } from "@/lib/types";

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RecentItineraries() {
  const router = useRouter();
  const [items, setItems] = useState<StoredItinerary[]>([]);

  useEffect(() => {
    setItems(getRecentItineraries());
  }, []);

  if (!items.length) return null;

  return (
    <section className="mx-auto mt-8 w-full max-w-xl rounded-3xl border border-white/60 bg-white/85 p-5 shadow-lg shadow-slate-200/70 backdrop-blur sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">최근 일정</h2>
        <span className="text-xs text-slate-500">{items.length}개 저장됨</span>
      </div>

      <div className="space-y-3">
        {items.slice(0, 6).map((item) => {
          const payload = normalizeTripPayload(item.payload);
          return (
            <article
              key={item.localId || `${item.generatedAt}-${payload.city}`}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">
                    {payload.city}, {payload.country}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {payload.nights}박 · {payload.budgetMode} · {payload.companionType} · {payload.pace}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDate(item.savedAt || item.generatedAt)} · {String(payload.dayStartHour).padStart(2, "0")}:00~
                    {String(payload.dayEndHour).padStart(2, "0")}:00
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!item.localId) return;
                      const opened = openRecentItinerary(item.localId);
                      if (opened) router.push("/itinerary");
                    }}
                    className="rounded-lg bg-violet-100 px-3 py-1.5 text-sm font-medium text-violet-700 transition hover:bg-violet-200"
                  >
                    열기
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!item.localId) return;
                      removeRecentItinerary(item.localId);
                      setItems(getRecentItineraries());
                    }}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
                  >
                    삭제
                  </button>
                </div>
              </div>
              {payload.travelStyles.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {payload.travelStyles.slice(0, 4).map((style) => (
                    <span
                      key={`${item.localId}-${style}`}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600"
                    >
                      {style}
                    </span>
                  ))}
                  {payload.travelStyles.length > 4 && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      +{payload.travelStyles.length - 4}
                    </span>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
