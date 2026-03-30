"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { getRecentItineraries, openRecentItinerary, removeRecentItinerary } from "@/lib/localItineraryStore";
import { setCurrentTrip } from "@/lib/tripSessionStore";
import { getTripStorageGateway, type TripSummary } from "@/lib/tripStorage";
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
  const auth = useAuth();
  const [localItems, setLocalItems] = useState<StoredItinerary[]>([]);
  const [remoteItems, setRemoteItems] = useState<TripSummary[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  useEffect(() => {
    setLocalItems(getRecentItineraries());
  }, []);

  useEffect(() => {
    if (auth.status !== "authenticated") {
      setRemoteItems([]);
      return;
    }

    const gateway = getTripStorageGateway(auth);
    setLoadingRemote(true);
    void gateway
      .loadTrips()
      .then(setRemoteItems)
      .catch(() => setRemoteItems([]))
      .finally(() => setLoadingRemote(false));
  }, [auth]);

  const hasLocalItems = localItems.length > 0;
  const showRemote = auth.status === "authenticated";
  const visibleLocalItems = useMemo(() => localItems.slice(0, 6), [localItems]);
  const visibleRemoteItems = useMemo(() => remoteItems.slice(0, 6), [remoteItems]);

  if (!hasLocalItems && !showRemote) return null;
  if (!hasLocalItems && showRemote && !loadingRemote && visibleRemoteItems.length === 0) return null;

  return (
    <section className="mx-auto mt-8 w-full max-w-xl space-y-4">
      {showRemote && (
        <div className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-lg shadow-slate-200/70 backdrop-blur sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">내 일정</h2>
            <span className="text-xs text-slate-500">
              {loadingRemote ? "불러오는 중..." : `${remoteItems.length}개 저장됨`}
            </span>
          </div>

          {hasLocalItems && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-amber-900">이 브라우저의 일정도 가져올 수 있어요.</p>
                  <p className="mt-1 text-xs text-amber-800">로컬에 저장된 {localItems.length}개 일정을 내 일정으로 복사합니다.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const gateway = getTripStorageGateway(auth);
                    if (!gateway.importLocalTrips) return;
                    setImportMessage(null);
                    void gateway.importLocalTrips().then((result) => {
                      setImportMessage(`${result.importedCount}개 일정을 내 일정으로 가져왔습니다.`);
                      return gateway.loadTrips().then(setRemoteItems);
                    });
                  }}
                  className="rounded-lg bg-amber-200 px-3 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-amber-300"
                >
                  로컬 일정 가져오기
                </button>
              </div>
              {importMessage && <p className="mt-2 text-xs text-amber-900">{importMessage}</p>}
            </div>
          )}

          <div className="space-y-3">
            {visibleRemoteItems.map((item) => (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{item.title}</div>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.city}, {item.country} · {item.nights}박
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{formatDate(item.updatedAt)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(`/itinerary?trip=${encodeURIComponent(item.id)}`)}
                    className="rounded-lg bg-violet-100 px-3 py-1.5 text-sm font-medium text-violet-700 transition hover:bg-violet-200"
                  >
                    열기
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {hasLocalItems && (
        <div className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-lg shadow-slate-200/70 backdrop-blur sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              {showRemote ? "이 브라우저의 최근 일정" : "최근 일정"}
            </h2>
            <span className="text-xs text-slate-500">{localItems.length}개 저장됨</span>
          </div>

          <div className="space-y-3">
            {visibleLocalItems.map((item) => {
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
                          setCurrentTrip(opened ?? item);
                          router.push("/itinerary");
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
                          setLocalItems(getRecentItineraries());
                        }}
                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
