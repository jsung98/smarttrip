import { normalizeStoredItinerary, type StoredItinerary } from "@/lib/types";
import { setCurrentTrip } from "@/lib/tripSessionStore";

const RECENT_KEY = "smart-trip-itineraries";
const MAX_RECENT = 12;

function isBrowser() {
  return typeof window !== "undefined";
}

function newLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readRecent(): StoredItinerary[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeStoredItinerary(item))
      .filter((item): item is StoredItinerary => !!item);
  } catch {
    return [];
  }
}

function writeRecent(items: StoredItinerary[]) {
  if (!isBrowser()) return;
  localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
}

export function prepareStoredItinerary(itinerary: StoredItinerary): StoredItinerary {
  const normalized = normalizeStoredItinerary(itinerary);
  if (!normalized) return itinerary;
  return {
    ...normalized,
    localId: normalized.localId || newLocalId(),
    savedAt: new Date().toISOString(),
  };
}

export function setCurrentItinerary(itinerary: StoredItinerary) {
  setCurrentTrip(itinerary);
}

export function saveRecentItinerary(itinerary: StoredItinerary): StoredItinerary {
  if (!isBrowser()) return itinerary;
  const next = prepareStoredItinerary(itinerary);
  const items = readRecent().filter((item) => item.localId !== next.localId);
  items.unshift(next);
  writeRecent(items);
  return next;
}

export function saveAndActivateItinerary(itinerary: StoredItinerary): StoredItinerary {
  const saved = saveRecentItinerary(itinerary);
  setCurrentItinerary(saved);
  return saved;
}

export function getRecentItineraries(): StoredItinerary[] {
  return readRecent();
}

export function removeRecentItinerary(localId: string) {
  if (!isBrowser()) return;
  const next = readRecent().filter((item) => item.localId !== localId);
  writeRecent(next);
}

export function openRecentItinerary(localId: string): StoredItinerary | null {
  const item = readRecent().find((x) => x.localId === localId) || null;
  if (item) setCurrentItinerary(item);
  return item;
}
