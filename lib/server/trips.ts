import type { NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, parseAuthSession, type AuthUser } from "@/lib/auth/session";
import { toTripDocument } from "@/lib/domain/trip-adapters";
import type { TripDocument } from "@/lib/domain/trip-document";
import { supabaseRequest } from "@/lib/supabaseServer";
import type { ImportResult, TripLoadResult, TripSaveResult, TripSummary } from "@/lib/tripStorage";
import { normalizeStoredItinerary, type StoredItinerary } from "@/lib/types";

type TripRow = {
  id: string;
  user_id: string;
  title: string;
  city: string;
  country: string;
  nights: number;
  document_json: TripDocument;
  snapshot_json: StoredItinerary;
  updated_at: string;
};

function encodeFilter(value: string) {
  return encodeURIComponent(`eq.${value}`);
}

function buildTripTitle(snapshot: StoredItinerary, document: TripDocument) {
  const firstDayTitle = document.days[0]?.title?.trim();
  return firstDayTitle ? `${snapshot.payload.city} · ${firstDayTitle}` : `${snapshot.payload.city} 여행`;
}

function toSummary(row: TripRow): TripSummary {
  return {
    id: row.id,
    title: row.title,
    city: row.city,
    country: row.country,
    nights: row.nights,
    updatedAt: row.updated_at,
    storage: "remote",
  };
}

function toLoadResult(row: TripRow): TripLoadResult | null {
  const snapshot = normalizeStoredItinerary(row.snapshot_json);
  if (!snapshot) return null;

  const remoteSnapshot: StoredItinerary = {
    ...snapshot,
    remoteTripId: row.id,
    remoteUpdatedAt: row.updated_at,
  };

  return {
    summary: toSummary(row),
    snapshot: remoteSnapshot,
    document: row.document_json || toTripDocument(remoteSnapshot),
  };
}

export function getAuthUserFromRequest(request: NextRequest): AuthUser | null {
  return parseAuthSession(request.cookies.get(AUTH_COOKIE_NAME)?.value);
}

export async function listUserTrips(userId: string): Promise<TripSummary[]> {
  const res = await supabaseRequest(
    `/rest/v1/user_trips?select=id,title,city,country,nights,updated_at&user_id=${encodeFilter(userId)}&order=updated_at.desc`,
    { method: "GET" }
  );
  const rows = (await res.json()) as Array<Pick<TripRow, "id" | "title" | "city" | "country" | "nights" | "updated_at">>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    city: row.city,
    country: row.country,
    nights: row.nights,
    updatedAt: row.updated_at,
    storage: "remote",
  }));
}

export async function getUserTrip(userId: string, tripId: string): Promise<TripLoadResult | null> {
  const res = await supabaseRequest(
    `/rest/v1/user_trips?select=id,user_id,title,city,country,nights,document_json,snapshot_json,updated_at&id=${encodeFilter(
      tripId
    )}&user_id=${encodeFilter(userId)}&limit=1`,
    { method: "GET" }
  );
  const rows = (await res.json()) as TripRow[];
  const row = rows[0];
  return row ? toLoadResult(row) : null;
}

export async function saveUserTrip(
  userId: string,
  snapshotInput: StoredItinerary,
  documentInput?: TripDocument
): Promise<TripSaveResult> {
  const snapshot = normalizeStoredItinerary(snapshotInput);
  if (!snapshot) {
    throw new Error("유효한 일정 데이터가 아닙니다.");
  }

  const document = documentInput ?? toTripDocument(snapshot);
  const title = buildTripTitle(snapshot, document);
  const res = await supabaseRequest(
    "/rest/v1/user_trips?select=id,user_id,title,city,country,nights,document_json,snapshot_json,updated_at",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: userId,
        title,
        city: snapshot.payload.city,
        country: snapshot.payload.country,
        nights: snapshot.payload.nights,
        document_json: document,
        snapshot_json: snapshot,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  const rows = (await res.json()) as TripRow[];
  const row = rows[0];
  if (!row) throw new Error("일정을 저장하지 못했습니다.");
  const loaded = toLoadResult(row);
  if (!loaded) throw new Error("저장한 일정을 읽지 못했습니다.");
  return {
    storage: "remote",
    summary: loaded.summary,
    snapshot: loaded.snapshot,
    document: loaded.document,
  };
}

export async function updateUserTrip(
  userId: string,
  tripId: string,
  snapshotInput: StoredItinerary,
  documentInput?: TripDocument
): Promise<TripSaveResult> {
  const snapshot = normalizeStoredItinerary(snapshotInput);
  if (!snapshot) {
    throw new Error("유효한 일정 데이터가 아닙니다.");
  }

  const document = documentInput ?? toTripDocument(snapshot);
  const title = buildTripTitle(snapshot, document);
  const res = await supabaseRequest(
    `/rest/v1/user_trips?id=${encodeFilter(tripId)}&user_id=${encodeFilter(userId)}&select=id,user_id,title,city,country,nights,document_json,snapshot_json,updated_at`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        title,
        city: snapshot.payload.city,
        country: snapshot.payload.country,
        nights: snapshot.payload.nights,
        document_json: document,
        snapshot_json: snapshot,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  const rows = (await res.json()) as TripRow[];
  const row = rows[0];
  if (!row) throw new Error("일정을 업데이트하지 못했습니다.");
  const loaded = toLoadResult(row);
  if (!loaded) throw new Error("업데이트한 일정을 읽지 못했습니다.");
  return {
    storage: "remote",
    summary: loaded.summary,
    snapshot: loaded.snapshot,
    document: loaded.document,
  };
}

export async function deleteUserTrip(userId: string, tripId: string) {
  await supabaseRequest(
    `/rest/v1/user_trips?id=${encodeFilter(tripId)}&user_id=${encodeFilter(userId)}`,
    { method: "DELETE" }
  );
}

export async function importUserTrips(userId: string, trips: StoredItinerary[]): Promise<ImportResult> {
  let importedCount = 0;
  for (const trip of trips) {
    const normalized = normalizeStoredItinerary(trip);
    if (!normalized) continue;
    await saveUserTrip(userId, normalized);
    importedCount += 1;
  }
  return { importedCount };
}
