import { NextRequest, NextResponse } from "next/server";
import { isSectionKey, normalizeStructuredPlan } from "@/lib/types";
import type { FinalItinerary, FinalPlace, SectionKey, StructuredPlan } from "@/types/plan";

type FillRequest = {
  structuredPlan?: StructuredPlan;
  city?: string;
  country?: string;
  target?: {
    day?: number;
    sectionKey?: SectionKey;
  };
};

type PlacesApiResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    rating?: number;
    location?: { latitude?: number; longitude?: number };
    formattedAddress?: string;
  }>;
};

type PlacesCacheValue = {
  places: FinalPlace[];
  fetchedAt: number;
};

type SectionPolicy = {
  min: number;
  max: number;
};

type ResolvedAreaHint = {
  lat: number;
  lng: number;
  radiusMeters: number;
} | null;

type SectionSearchSpec = {
  includedType?: string;
  suffix: string;
  policy: SectionPolicy;
};

type SearchResult = {
  places: FinalPlace[];
  source: "cache" | "google" | "google_no_type_fallback";
};

const placesCache = new Map<string, PlacesCacheValue>();

const GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const INCLUDED_TYPE_FALLBACK_ENABLED = true;
const SEARCH_CONCURRENCY = 3;

const SECTION_POLICY: Record<SectionKey, SectionPolicy> = {
  morning: { min: 1, max: 1 },
  lunch: { min: 1, max: 3 },
  afternoon: { min: 1, max: 1 },
  dinner: { min: 1, max: 3 },
  night: { min: 1, max: 1 },
};

function getGoogleMapsKey() {
  return process.env.GOOGLE_MAPS_API_KEY?.trim();
}

function sortByRatingDesc(items: FinalPlace[]) {
  return items.slice().sort((a, b) => b.rating - a.rating);
}

function getSectionPolicy(sectionKey: SectionKey): SectionPolicy {
  return SECTION_POLICY[sectionKey];
}

function getNightStrategy(intent: string): { includedType: string; suffix: string } {
  const normalized = intent.toLowerCase();
  if (
    normalized.includes("야경") ||
    normalized.includes("전망") ||
    normalized.includes("뷰") ||
    normalized.includes("observatory")
  ) {
    return { includedType: "tourist_attraction", suffix: "night view skyline observatory" };
  }
  if (
    normalized.includes("산책") ||
    normalized.includes("거리") ||
    normalized.includes("walk") ||
    normalized.includes("street")
  ) {
    return { includedType: "point_of_interest", suffix: "night walk street" };
  }
  if (
    normalized.includes("바") ||
    normalized.includes("술") ||
    normalized.includes("bar") ||
    normalized.includes("pub")
  ) {
    return { includedType: "bar", suffix: "bar lounge" };
  }
  return { includedType: "tourist_attraction", suffix: "night landmark" };
}

function buildSectionSearchSpec(section: StructuredPlan["days"][number]["sections"][number]): SectionSearchSpec {
  const policy = getSectionPolicy(section.key);
  if (section.key === "lunch" || section.key === "dinner") {
    return {
      includedType: "restaurant",
      suffix: "restaurant local food",
      policy,
    };
  }
  if (section.key === "morning" || section.key === "afternoon") {
    return {
      includedType: "tourist_attraction",
      suffix: "tourist attraction sightseeing",
      policy,
    };
  }
  const night = getNightStrategy(section.intent || "");
  return {
    includedType: night.includedType,
    suffix: night.suffix,
    policy,
  };
}

function buildMapsUrl(placeId: string) {
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

function buildBiasBucket(bias: ResolvedAreaHint): string {
  if (!bias) return "nobias";
  return `${bias.lat.toFixed(3)},${bias.lng.toFixed(3)},${Math.round(bias.radiusMeters)}`;
}

function makeCacheKeyExpanded(params: {
  city: string;
  country: string;
  sectionKey: SectionKey;
  intent: string;
  areaHint?: string;
  includedType?: string;
  biasBucket: string;
}) {
  return [
    params.city,
    params.country,
    params.sectionKey,
    params.intent,
    params.areaHint ?? "",
    params.includedType ?? "notype",
    params.biasBucket,
  ]
    .join("|")
    .toLowerCase();
}

function shouldBypassCache(
  target: FillRequest["target"],
  day: number,
  sectionKey: SectionKey
): boolean {
  if (!target) return false;
  if (typeof target.day !== "number" || !Number.isInteger(target.day)) return false;
  if (target.day !== day) return false;
  if (!target.sectionKey) return true;
  if (!isSectionKey(target.sectionKey)) return false;
  return target.sectionKey === sectionKey;
}

function normalizePlacesApiResults(json: PlacesApiResponse): FinalPlace[] {
  if (!Array.isArray(json.places)) return [];

  return json.places
    .map((place): FinalPlace | null => {
      const placeId = place.id?.trim();
      const name = place.displayName?.text?.trim();
      const rating = place.rating;
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;

      if (!placeId) return null;
      if (!name) return null;
      if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
      if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
      if (typeof lng !== "number" || !Number.isFinite(lng)) return null;

      return {
        name,
        lat,
        lng,
        rating,
        address: place.formattedAddress?.trim() || undefined,
        placeId,
        mapsUrl: buildMapsUrl(placeId),
      };
    })
    .filter((item): item is FinalPlace => !!item);
}

function pickByThresholdWithFallback(candidates: FinalPlace[], max: number): FinalPlace[] {
  const sorted = sortByRatingDesc(candidates);
  const thresholds = [4.5, 4.3, 4.0];

  for (const threshold of thresholds) {
    const filtered = sorted.filter((item) => item.rating >= threshold);
    const ranked = sortByRatingDesc(filtered);
    if (ranked.length > 0) return ranked.slice(0, max);
  }

  return sorted.length > 0 ? sorted.slice(0, 1) : [];
}

async function searchPlacesOnce(params: {
  textQuery: string;
  includedType?: string;
  bias: ResolvedAreaHint;
  apiKey: string;
}): Promise<FinalPlace[]> {
  const body: Record<string, unknown> = {
    textQuery: params.textQuery,
    languageCode: "ko",
    pageSize: 10,
  };

  if (params.includedType) body.includedType = params.includedType;
  if (params.bias) {
    body.locationBias = {
      circle: {
        center: {
          latitude: params.bias.lat,
          longitude: params.bias.lng,
        },
        radius: params.bias.radiusMeters,
      },
    };
  }

  const response = await fetch(GOOGLE_PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": params.apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.rating,places.location,places.formattedAddress",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`google_places_http_${response.status}`);
  }

  const json = (await response.json()) as PlacesApiResponse;
  return normalizePlacesApiResults(json);
}

async function resolveCityCenterBias(params: {
  city: string;
  country: string;
  apiKey: string;
}): Promise<ResolvedAreaHint> {
  try {
    const candidates = await searchPlacesOnce({
      textQuery: `${params.city} ${params.country}`.trim(),
      bias: null,
      apiKey: params.apiKey,
    });
    const top = candidates[0];
    if (!top) return null;
    return {
      lat: top.lat,
      lng: top.lng,
      radiusMeters: 4000,
    };
  } catch {
    return null;
  }
}

async function resolveAreaHintToBias(params: {
  areaHint?: string;
  city: string;
  country: string;
  apiKey: string;
}): Promise<ResolvedAreaHint> {
  const hint = params.areaHint?.trim();
  if (hint) {
    try {
      const candidates = await searchPlacesOnce({
        textQuery: `${hint} ${params.city} ${params.country}`.trim(),
        bias: null,
        apiKey: params.apiKey,
      });
      const top = candidates[0];
      if (top) {
        return {
          lat: top.lat,
          lng: top.lng,
          radiusMeters: 3000,
        };
      }
    } catch {
      // ignore and fallback to city center
    }
  }
  return resolveCityCenterBias({
    city: params.city,
    country: params.country,
    apiKey: params.apiKey,
  });
}

async function searchPlacesWithFallback(params: {
  city: string;
  country: string;
  section: StructuredPlan["days"][number]["sections"][number];
  spec: SectionSearchSpec;
  apiKey: string;
  bias: ResolvedAreaHint;
}): Promise<{ places: FinalPlace[]; source: "google" | "google_no_type_fallback" }> {
  const textQuery = `${params.section.intent} ${params.section.areaHint ?? ""} ${params.city} ${params.country} ${params.spec.suffix}`.trim();
  const max = params.spec.policy.max;

  const firstCandidates = await searchPlacesOnce({
    textQuery,
    includedType: params.spec.includedType,
    bias: params.bias,
    apiKey: params.apiKey,
  });
  const firstPicked = pickByThresholdWithFallback(firstCandidates, max);
  if (firstPicked.length > 0 || !params.spec.includedType || !INCLUDED_TYPE_FALLBACK_ENABLED) {
    return { places: firstPicked, source: "google" };
  }

  const fallbackCandidates = await searchPlacesOnce({
    textQuery,
    bias: params.bias,
    apiKey: params.apiKey,
  });
  return {
    places: pickByThresholdWithFallback(fallbackCandidates, max),
    source: "google_no_type_fallback",
  };
}

async function searchPlacesForSection(params: {
  key: string;
  city: string;
  country: string;
  section: StructuredPlan["days"][number]["sections"][number];
  spec: SectionSearchSpec;
  bypassCache: boolean;
  apiKey: string;
  bias: ResolvedAreaHint;
}): Promise<SearchResult> {
  if (!params.bypassCache) {
    const cached = placesCache.get(params.key);
    if (cached) return { places: cached.places, source: "cache" };
  }

  const searched = await searchPlacesWithFallback({
    city: params.city,
    country: params.country,
    section: params.section,
    spec: params.spec,
    apiKey: params.apiKey,
    bias: params.bias,
  });

  placesCache.set(params.key, { places: searched.places, fetchedAt: Date.now() });
  return searched;
}

async function runWithConcurrencyLimit<T>(
  limit: number,
  tasks: Array<() => Promise<T>>
): Promise<Array<PromiseSettledResult<T>>> {
  if (tasks.length === 0) return [];

  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= tasks.length) return;
      try {
        const value = await tasks[idx]();
        results[idx] = { status: "fulfilled", value };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function POST(request: NextRequest) {
  const apiKey = getGoogleMapsKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY臧€ ?れ爼?橃柎 ?堨? ?婌姷?堧嫟." },
      { status: 500 }
    );
  }

  let body: FillRequest;
  try {
    body = (await request.json()) as FillRequest;
  } catch {
    return NextResponse.json({ error: "?橂???旍箔?呺媹??" }, { status: 400 });
  }

  const city = body.city?.trim();
  const country = body.country?.trim();
  const structuredPlan = normalizeStructuredPlan(body.structuredPlan);
  if (!city || !country || !structuredPlan) {
    return NextResponse.json({ error: "structuredPlan, city, country臧€ ?勳殧?╇媹??" }, { status: 400 });
  }

  const warnings: string[] = [];
  let searchedCount = 0;
  let searchedErrorCount = 0;
  const finalItinerary: FinalItinerary = { days: [] };
  const biasMemo = new Map<string, ResolvedAreaHint>();

  for (const day of structuredPlan.days) {
    const sectionTasks = day.sections.map((section) => async () => {
      const spec = buildSectionSearchSpec(section);
      const policy = spec.policy;
      const nextSection = {
        key: section.key,
        title: section.title,
        intent: section.intent,
        areaHint: section.areaHint,
        durationMinutes: section.durationMinutes,
        foodRequired: section.foodRequired,
        places: [] as FinalPlace[],
      };

      searchedCount += 1;

      const areaHintKey = `${city}|${country}|${section.areaHint ?? ""}`.toLowerCase();
      let bias = biasMemo.get(areaHintKey);
      if (bias === undefined) {
        bias = await resolveAreaHintToBias({
          areaHint: section.areaHint,
          city,
          country,
          apiKey,
        });
        biasMemo.set(areaHintKey, bias);
      }

      const cacheKey = makeCacheKeyExpanded({
        city,
        country,
        sectionKey: section.key,
        intent: section.intent,
        areaHint: section.areaHint,
        includedType: spec.includedType,
        biasBucket: buildBiasBucket(bias),
      });
      const bypassCache = shouldBypassCache(body.target, day.day, section.key);

      try {
        const { places, source } = await searchPlacesForSection({
          key: cacheKey,
          city,
          country,
          section,
          spec,
          bypassCache,
          apiKey,
          bias,
        });
        nextSection.places = places.slice(0, policy.max);
        if (nextSection.places.length < policy.min) {
          warnings.push(
            `Day ${day.day} ${section.title}: 최소 추천 개수(${policy.min})를 충족하지 못했습니다. (${source})`
          );
        }
      } catch (err) {
        searchedErrorCount += 1;
        const reason = err instanceof Error ? err.message : "unknown_error";
        warnings.push(`Day ${day.day} ${section.title}: Places 검색 실패 (${reason})`);
      }

      return nextSection;
    });

    const settled = await runWithConcurrencyLimit(SEARCH_CONCURRENCY, sectionTasks);
    const sections = settled.map((result, idx) => {
      if (result.status === "fulfilled") return result.value;
      const section = day.sections[idx];
      return {
        key: section.key,
        title: section.title,
        intent: section.intent,
        areaHint: section.areaHint,
        durationMinutes: section.durationMinutes,
        foodRequired: section.foodRequired,
        places: [] as FinalPlace[],
      };
    });

    finalItinerary.days.push({
      day: day.day,
      sections,
    });
  }

  if (searchedCount > 0 && searchedErrorCount === searchedCount) {
    warnings.push("Google Places 호출이 모두 실패했습니다. 장소 추천 결과가 비어 있을 수 있습니다.");
  }

  return NextResponse.json({ finalItinerary, warnings });
}
