import { NextRequest, NextResponse } from "next/server";

type LookupResult = {
  query: string;
  found: boolean;
  lat?: number;
  lon?: number;
  address?: string;
  dayNum?: number;
  order?: number;
  section?: string;
  name?: string;
};

type LookupItem = { name: string; dayNum?: number; order?: number; section?: string };

const cache = new Map<string, LookupResult>();

function buildQuery(name: string, city?: string, country?: string) {
  return [name, city, country].filter(Boolean).join(" ");
}

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

const GOOGLE_OK_STATUSES = new Set(["OK", "ZERO_RESULTS"]);

function getGoogleKey() {
  return process.env.GOOGLE_MAPS_API_KEY?.trim();
}

export async function POST(request: NextRequest) {
  let body: { names?: string[]; items?: LookupItem[]; city?: string; country?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const items = Array.isArray(body.items)
    ? body.items
        .map((x) => ({
          name: String(x?.name || "").trim(),
          dayNum: Number.isFinite(Number(x?.dayNum)) ? Number(x?.dayNum) : undefined,
          order: Number.isFinite(Number(x?.order)) ? Number(x?.order) : undefined,
          section: x?.section ? String(x.section) : undefined,
        }))
        .filter((x) => x.name)
    : [];

  const names = Array.isArray(body.names)
    ? body.names.map((x) => String(x).trim()).filter(Boolean)
    : [];

  const inputItems: LookupItem[] = items.length > 0 ? items : names.map((name) => ({ name }));
  if (!inputItems.length) {
    return NextResponse.json({ error: "장소명이 필요합니다." }, { status: 400 });
  }

  const city = body.city?.trim() || "";
  const country = body.country?.trim() || "";

  const limited = inputItems.slice(0, 20);
  const results: LookupResult[] = [];

  const tryGoogle = async (q: string): Promise<LookupResult | null> => {
    const key = getGoogleKey();
    if (!key) return null;
    const url = new URL(GOOGLE_GEOCODE_URL);
    url.searchParams.set("address", q);
    url.searchParams.set("key", key);
    url.searchParams.set("language", "ko");
    url.searchParams.set("region", "kr");

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    if (!GOOGLE_OK_STATUSES.has(json.status)) return null;
    const item = json.results?.[0];
    const lat = item?.geometry?.location?.lat;
    const lon = item?.geometry?.location?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      query: q,
      found: true,
      lat: Number(lat),
      lon: Number(lon),
      address: item?.formatted_address,
    };
  };

  const tryOsm = async (q: string): Promise<LookupResult | null> => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "0");

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "smart-trip-planner/1.0",
        "Accept-Language": "ko,en",
      },
      cache: "no-store",
    });

    if (!res.ok) return null;

    const json = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;
    const item = json?.[0];
    if (!item) return null;
    return {
      query: q,
      found: true,
      lat: Number(item.lat),
      lon: Number(item.lon),
      address: item.display_name,
    };
  };

  for (const item of limited) {
    const name = item.name;
    const query = buildQuery(name, city, country);
    const cacheKey = query.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) {
      results.push({ ...cached, name, dayNum: item.dayNum, order: item.order, section: item.section });
      continue;
    }

    let result =
      (await tryGoogle(query)) ||
      (await tryGoogle(name)) ||
      (await tryOsm(query)) ||
      (await tryOsm(name));

    if (!result) {
      result = { query: name, found: false };
    }

    result.dayNum = item.dayNum;
    result.order = item.order;
    result.section = item.section;
    result.name = name;

    cache.set(cacheKey, result);
    results.push(result);
  }

  const notFound = results.filter((r) => !r.found).length;
  let fallback: LookupResult | null = null;
  if (notFound === results.length) {
    const cityQuery = [city, country].filter(Boolean).join(" ");
    if (cityQuery) {
      fallback = (await tryGoogle(cityQuery)) || (await tryOsm(cityQuery));
      if (fallback) {
        fallback.query = city || country || cityQuery;
        fallback.found = true;
      }
    }
  }

  return NextResponse.json({
    provider: getGoogleKey() ? "google" : "nominatim",
    checked: results.length,
    notFound,
    results,
    fallback,
  });
}
