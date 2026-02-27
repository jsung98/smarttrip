"use client";

import { useState, useEffect, FormEvent, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  BUDGET_MODES,
  COMPANION_TYPES,
  DEFAULT_TRIP_PREFERENCES,
  PACE_MODES,
  TRAVEL_STYLES,
  normalizeTripPayload,
  type TripFormData,
  type TravelStyle,
} from "@/lib/types";
import { saveAndActivateItinerary } from "@/lib/localItineraryStore";
import { Combo } from "@/components/CountryCityCombo";

const NIGHTS_OPTIONS = Array.from({ length: 14 }, (_, i) => i + 1);
const HOUR_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 6);
type CountryOption = { code: string; name: string; nameKo?: string };

interface TripFormProps {
  initialCountries: CountryOption[];
}

export default function TripForm({ initialCountries }: TripFormProps) {
  const router = useRouter();
  const [countryCode, setCountryCode] = useState("");
  const [city, setCity] = useState("");
  const [nights, setNights] = useState<number>(3);
  const [travelStyles, setTravelStyles] = useState<TravelStyle[]>([]);
  const [budgetMode, setBudgetMode] = useState(DEFAULT_TRIP_PREFERENCES.budgetMode);
  const [companionType, setCompanionType] = useState(DEFAULT_TRIP_PREFERENCES.companionType);
  const [pace, setPace] = useState(DEFAULT_TRIP_PREFERENCES.pace);
  const [dayStartHour, setDayStartHour] = useState(DEFAULT_TRIP_PREFERENCES.dayStartHour);
  const [dayEndHour, setDayEndHour] = useState(DEFAULT_TRIP_PREFERENCES.dayEndHour);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [countries] = useState<CountryOption[]>(initialCountries);
  const [cities, setCities] = useState<{ name: string; nameKo?: string; lat?: number; lon?: number }[]>([]);
  const [countriesLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(false);

  useEffect(() => {
    if (!countryCode.trim()) {
      setCities([]);
      setCity("");
      return;
    }
    setCitiesLoading(true);
    setCity("");
    fetch(`/api/cities?country=${encodeURIComponent(countryCode)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.cities) setCities(data.cities);
        else setCities([]);
      })
      .catch(() => setCities([]))
      .finally(() => setCitiesLoading(false));
  }, [countryCode]);

  const countryOptions = useMemo(
    () =>
      countries.map((c) => ({
        value: c.code,
        label: c.nameKo ? `${c.nameKo} (${c.name})` : c.name,
      })),
    [countries]
  );

  const cityOptions = useMemo(
    () =>
      cities.map((c) => ({
        value: c.name,
        label: c.nameKo ? `${c.nameKo} (${c.name})` : c.name,
      })),
    [cities]
  );

  const toggleStyle = (style: TravelStyle) => {
    setTravelStyles((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoadingStep(0);

    const cityTrim = city.trim();
    if (!countryCode.trim() || !cityTrim) {
      setError("국가와 도시를 선택해 주세요.");
      return;
    }
    if (dayEndHour <= dayStartHour) {
      setError("활동 종료 시간은 시작 시간보다 늦어야 합니다.");
      return;
    }
    const cityMatch = cities.find(
      (c) =>
        c.name.toLowerCase() === cityTrim.toLowerCase() ||
        c.nameKo?.toLowerCase() === cityTrim.toLowerCase()
    );
    if (cities.length > 0 && !cityMatch) {
      setError("선택한 국가의 도시 목록에서 도시를 골라 주세요.");
      return;
    }
    const countryMeta = countries.find((c) => c.code === countryCode);
    const countryLabel = countryMeta?.nameKo ?? countryMeta?.name ?? countryCode;
    const cityValue = cityMatch?.name ?? cityTrim;
    const cityLabel = cityMatch?.nameKo ?? cityValue;

    setLoading(true);
    try {
      setLoadingStep(1);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: countryLabel,
          city: cityLabel,
          nights,
          travelStyles,
          budgetMode,
          companionType,
          pace,
          dayStartHour,
          dayEndHour,
        }),
      });

      setLoadingStep(2);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "오류가 발생했습니다.");
        setLoading(false);
        return;
      }

      const payload = normalizeTripPayload({
        country: countryLabel,
        city: cityLabel,
        nights,
        travelStyles,
        budgetMode,
        companionType,
        pace,
        dayStartHour,
        dayEndHour,
        cityLat: cityMatch?.lat,
        cityLon: cityMatch?.lon,
        cityEn: cityMatch?.name,
        countryCode,
      });

      setLoadingStep(3);
      saveAndActivateItinerary({
        markdown: data.markdown,
        itinerary: data.itinerary,
        payload,
        generatedAt: new Date().toISOString(),
      });

      router.push("/itinerary");
    } catch {
      setError("네트워크 오류입니다. 다시 시도해 주세요.");
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative mx-auto w-full max-w-xl space-y-6 rounded-3xl border border-white/60 bg-white/90 p-6 shadow-xl shadow-slate-200/70 backdrop-blur sm:p-8"
    >
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-white/75 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-3 px-6 text-center">
            <p className="text-sm font-semibold text-slate-700">
              {loadingStep <= 1 && "일정을 찾고 있습니다..."}
              {loadingStep === 2 && "일정을 정리하고 있습니다..."}
              {loadingStep >= 3 && "마지막 정리 중입니다..."}
            </p>
            <div className="progress-indeterminate h-2 w-full rounded-full" />
            <div className="flex flex-wrap justify-center gap-2 text-[11px] text-slate-500">
              <span className={loadingStep >= 1 ? "text-slate-700" : ""}>장소 탐색</span>
              <span>·</span>
              <span className={loadingStep >= 2 ? "text-slate-700" : ""}>동선 구성</span>
              <span>·</span>
              <span className={loadingStep >= 3 ? "text-slate-700" : ""}>일정 정리</span>
            </div>
          </div>
        </div>
      )}
      <Combo
        label="국가"
        placeholder="한글 또는 영어로 검색 (예: 대한민국, Japan)"
        value={countryCode}
        onChange={setCountryCode}
        options={countryOptions}
        loading={countriesLoading}
        required
        data-testid="country-combo"
      />

      <Combo
        label="도시"
        placeholder={countryCode ? "도시를 검색하거나 선택" : "먼저 국가를 선택해 주세요"}
        value={city}
        onChange={setCity}
        options={cityOptions}
        loading={citiesLoading}
        disabled={!countryCode.trim()}
        required
        data-testid="city-combo"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nights" className="mb-1.5 block text-sm font-semibold text-slate-700">
            숙박 일수
          </label>
          <select
            id="nights"
            value={nights}
            onChange={(e) => setNights(Number(e.target.value))}
            className="w-full rounded-xl border-2 border-slate-200 bg-white/80 px-4 py-3 text-slate-900 transition focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          >
            {NIGHTS_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}박
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="budgetMode" className="mb-1.5 block text-sm font-semibold text-slate-700">
            예산 모드
          </label>
          <select
            id="budgetMode"
            value={budgetMode}
            onChange={(e) => setBudgetMode(e.target.value as typeof budgetMode)}
            className="w-full rounded-xl border-2 border-slate-200 bg-white/80 px-4 py-3 text-slate-900 transition focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          >
            {BUDGET_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="companionType" className="mb-1.5 block text-sm font-semibold text-slate-700">
            동행 유형
          </label>
          <select
            id="companionType"
            value={companionType}
            onChange={(e) => setCompanionType(e.target.value as typeof companionType)}
            className="w-full rounded-xl border-2 border-slate-200 bg-white/80 px-4 py-3 text-slate-900 transition focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          >
            {COMPANION_TYPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pace" className="mb-1.5 block text-sm font-semibold text-slate-700">
            여행 속도
          </label>
          <select
            id="pace"
            value={pace}
            onChange={(e) => setPace(e.target.value as typeof pace)}
            className="w-full rounded-xl border-2 border-slate-200 bg-white/80 px-4 py-3 text-slate-900 transition focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          >
            {PACE_MODES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dayStartHour" className="mb-1.5 block text-sm font-semibold text-slate-700">
            활동 시작 시간
          </label>
          <select
            id="dayStartHour"
            value={dayStartHour}
            onChange={(e) => setDayStartHour(Number(e.target.value))}
            className="w-full rounded-xl border-2 border-slate-200 bg-white/80 px-4 py-3 text-slate-900 transition focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={`start-${h}`} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="dayEndHour" className="mb-1.5 block text-sm font-semibold text-slate-700">
            활동 종료 시간
          </label>
          <select
            id="dayEndHour"
            value={dayEndHour}
            onChange={(e) => setDayEndHour(Number(e.target.value))}
            className="w-full rounded-xl border-2 border-slate-200 bg-white/80 px-4 py-3 text-slate-900 transition focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={`end-${h}`} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm font-semibold text-slate-700">여행 스타일</span>
        <div className="flex flex-wrap gap-2">
          {TRAVEL_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => toggleStyle(style)}
              className={`rounded-full px-4 py-2.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-violet-500/40 ${
                travelStyles.includes(style)
                  ? "bg-violet-600 text-white shadow-lg shadow-violet-500/30"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {style}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
        생성 기준: {budgetMode} 예산 · {companionType} · {pace} 일정 · {String(dayStartHour).padStart(2, "0")}:00~{String(dayEndHour).padStart(2, "0")}:00 활동
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-4 font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:from-violet-700 hover:to-fuchsia-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? "일정 생성 중..." : "일정 만들기"}
      </button>
    </form>
  );
}
