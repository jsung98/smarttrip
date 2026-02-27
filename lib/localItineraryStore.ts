import type { StoredItinerary } from "@/lib/types";

const CURRENT_KEY = "smart-trip-itinerary";
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
    return parsed.filter(
      (item): item is StoredItinerary =>
        !!item &&
        typeof item === "object" &&
        typeof (item as StoredItinerary).markdown === "string" &&
        typeof (item as StoredItinerary).generatedAt === "string" &&
        !!(item as StoredItinerary).payload
    );
  } catch {
    return [];
  }
}

function writeRecent(items: StoredItinerary[]) {
  if (!isBrowser()) return;
  localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
}

export function prepareStoredItinerary(itinerary: StoredItinerary): StoredItinerary {
  return {
    ...itinerary,
    localId: itinerary.localId || newLocalId(),
    savedAt: new Date().toISOString(),
  };
}

export function setCurrentItinerary(itinerary: StoredItinerary) {
  if (!isBrowser()) return;
  sessionStorage.setItem(CURRENT_KEY, JSON.stringify(itinerary));
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
