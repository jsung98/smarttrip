import { toTripDocument } from "@/lib/domain/trip-adapters";
import type { TripDocument } from "@/lib/domain/trip-document";
import type { AuthUser } from "@/lib/auth/session";
import {
  getRecentItineraries,
  openRecentItinerary,
  removeRecentItinerary,
  saveRecentItinerary,
} from "@/lib/localItineraryStore";
import { setCurrentTrip } from "@/lib/tripSessionStore";
import { normalizeStoredItinerary, type StoredItinerary } from "@/lib/types";

export type StorageKind = "local" | "remote";
export type SaveMode = "draft" | "saved";

export type AuthState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "authenticated"; user: AuthUser };

export interface TripSummary {
  id: string;
  title: string;
  city: string;
  country: string;
  nights: number;
  updatedAt: string;
  storage: StorageKind;
}

export interface TripLoadResult {
  summary: TripSummary;
  snapshot: StoredItinerary;
  document: TripDocument;
}

export interface TripSaveInput {
  snapshot: StoredItinerary;
  document: TripDocument;
  mode: SaveMode;
  tripId?: string;
}

export interface TripSaveResult {
  storage: StorageKind;
  summary: TripSummary;
  snapshot: StoredItinerary;
  document: TripDocument;
}

export interface ImportResult {
  importedCount: number;
}

export interface TripStorageGateway {
  saveTrip(input: TripSaveInput): Promise<TripSaveResult>;
  loadTrips(): Promise<TripSummary[]>;
  loadTrip(tripId: string): Promise<TripLoadResult | null>;
  deleteTrip(tripId: string): Promise<void>;
  importLocalTrips?(): Promise<ImportResult>;
}

function buildLocalSummary(snapshot: StoredItinerary): TripSummary {
  const document = toTripDocument(snapshot);
  const firstDayTitle = document.days[0]?.title?.trim();
  return {
    id: snapshot.localId || document.id,
    title: firstDayTitle ? `${snapshot.payload.city} · ${firstDayTitle}` : `${snapshot.payload.city} 여행`,
    city: snapshot.payload.city,
    country: snapshot.payload.country,
    nights: snapshot.payload.nights,
    updatedAt: snapshot.savedAt || snapshot.generatedAt,
    storage: "local",
  };
}

async function jsonFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || "요청 처리에 실패했습니다.");
  }
  return json;
}

class GuestTripStorageGateway implements TripStorageGateway {
  async saveTrip(input: TripSaveInput): Promise<TripSaveResult> {
    const saved = saveRecentItinerary(input.snapshot);
    setCurrentTrip(saved);
    return {
      storage: "local",
      summary: buildLocalSummary(saved),
      snapshot: saved,
      document: input.document,
    };
  }

  async loadTrips(): Promise<TripSummary[]> {
    return getRecentItineraries().map(buildLocalSummary);
  }

  async loadTrip(tripId: string): Promise<TripLoadResult | null> {
    const opened = openRecentItinerary(tripId);
    if (!opened) return null;
    return {
      summary: buildLocalSummary(opened),
      snapshot: opened,
      document: toTripDocument(opened),
    };
  }

  async deleteTrip(tripId: string): Promise<void> {
    removeRecentItinerary(tripId);
  }
}

class UserTripStorageGateway implements TripStorageGateway {
  async saveTrip(input: TripSaveInput): Promise<TripSaveResult> {
    setCurrentTrip(input.snapshot);
    const tripId = input.tripId || input.snapshot.remoteTripId;
    const method = tripId ? "PUT" : "POST";
    const path = tripId ? `/api/trips/${encodeURIComponent(tripId)}` : "/api/trips";
    const result = await jsonFetch<TripSaveResult>(path, {
      method,
      body: JSON.stringify({
        mode: input.mode,
        snapshot: input.snapshot,
        document: input.document,
      }),
    });
    setCurrentTrip(result.snapshot);
    return result;
  }

  async loadTrips(): Promise<TripSummary[]> {
    const data = await jsonFetch<{ items: TripSummary[] }>("/api/trips");
    return data.items;
  }

  async loadTrip(tripId: string): Promise<TripLoadResult | null> {
    const result = await jsonFetch<TripLoadResult>(`/api/trips/${encodeURIComponent(tripId)}`);
    setCurrentTrip(result.snapshot);
    return result;
  }

  async deleteTrip(tripId: string): Promise<void> {
    await jsonFetch<{ ok: true }>(`/api/trips/${encodeURIComponent(tripId)}`, {
      method: "DELETE",
    });
  }

  async importLocalTrips(): Promise<ImportResult> {
    const snapshots = getRecentItineraries();
    if (!snapshots.length) return { importedCount: 0 };
    const data = await jsonFetch<ImportResult>("/api/trips/import", {
      method: "POST",
      body: JSON.stringify({ trips: snapshots }),
    });
    return data;
  }
}

const guestGateway = new GuestTripStorageGateway();
const userGateway = new UserTripStorageGateway();

export function getTripStorageGateway(authState: AuthState): TripStorageGateway {
  return authState.status === "authenticated" ? userGateway : guestGateway;
}

export function normalizeTripLoadResult(input: TripLoadResult | null): TripLoadResult | null {
  if (!input) return null;
  const snapshot = normalizeStoredItinerary(input.snapshot);
  if (!snapshot) return null;
  return {
    ...input,
    snapshot,
    document: input.document,
  };
}
