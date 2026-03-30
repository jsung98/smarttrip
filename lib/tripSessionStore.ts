import { normalizeStoredItinerary, type StoredItinerary } from "@/lib/types";

export const CURRENT_TRIP_KEY = "smart-trip-itinerary";

function isBrowser() {
  return typeof window !== "undefined";
}

export function setCurrentTrip(itinerary: StoredItinerary) {
  if (!isBrowser()) return;
  const normalized = normalizeStoredItinerary(itinerary);
  if (!normalized) return;
  sessionStorage.setItem(CURRENT_TRIP_KEY, JSON.stringify(normalized));
}

export function getCurrentTrip(): StoredItinerary | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(CURRENT_TRIP_KEY);
    if (!raw) return null;
    return normalizeStoredItinerary(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearCurrentTrip() {
  if (!isBrowser()) return;
  sessionStorage.removeItem(CURRENT_TRIP_KEY);
}
