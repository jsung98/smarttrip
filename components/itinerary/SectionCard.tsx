"use client";

type SectionPlace = {
  id?: string;
  name: string;
  rating: number;
  address?: string;
  mapsUrl?: string;
};

type SectionData = {
  sectionKey: string;
  title: string;
  type: "tour" | "meal";
  status: "ready" | "loading" | "empty" | "error" | "regenerating";
  places: SectionPlace[];
};

type SectionCardProps = {
  dayNum: number;
  section: SectionData;
  placeOrderLookup: Map<string, number>;
  onFocusPlace: (dayNum: number, name: string, placeId?: string) => void;
};

export default function SectionCard({ dayNum, section, placeOrderLookup, onFocusPlace }: SectionCardProps) {
  return (
    <section className="space-y-2">
      <h3 className={`text-base font-semibold ${section.type === "meal" ? "text-rose-700" : "text-violet-800"}`}>
        {section.title}
      </h3>
      <article className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        {section.status === "regenerating" ? (
          <p className="mb-2 text-xs font-medium text-violet-700">이 섹션을 다시 생성하고 있습니다...</p>
        ) : null}
        {section.status === "error" ? (
          <p className="mb-2 text-xs font-medium text-rose-700">섹션 재생성에 실패했습니다. 다시 시도해 주세요.</p>
        ) : null}
        {section.places.length > 0 ? (
          <div className="space-y-2">
            {section.places.map((place, idx) => (
              <article
                key={`hybrid-place-${dayNum}-${section.sectionKey}-${idx}-${place.name}`}
                id={`place-${
                  placeOrderLookup.get(
                    place.id ?? `${dayNum}::${section.title ?? ""}::${place.name.trim().toLowerCase()}`
                  ) ?? `missing-${dayNum}-${section.sectionKey}-${idx}`
                }`}
                className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{place.name}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      평점 {Number.isFinite(place.rating) ? place.rating.toFixed(1) : "-"}
                    </p>
                    {place.address ? <p className="mt-1 text-xs text-slate-600">{place.address}</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (place.mapsUrl) {
                        window.open(place.mapsUrl, "_blank", "noopener,noreferrer");
                        return;
                      }
                      onFocusPlace(dayNum, place.name, place.id);
                    }}
                    className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                  >
                    지도
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600">장소를 찾지 못했습니다.</p>
        )}
      </article>
    </section>
  );
}
