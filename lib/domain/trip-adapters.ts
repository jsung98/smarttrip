import type { StoredItinerary } from "@/lib/types";
import { FIXED_SECTION_KEYS } from "@/lib/types";
import type {
  TripDay,
  TripDocument,
  TripMeta,
  TripPlace,
  TripSection,
  TripSectionId,
  TripSectionStatus,
} from "@/lib/domain/trip-document";
import type { FinalItinerary, FinalPlace, FinalSection, SectionKey, StructuredPlan, StructuredSection } from "@/types/plan";

const DAY_HEADER_PATTERN = /^## Day (\d+)(?:\s*(?:-|–|—|·)\s*(.*))?$/gm;

const FALLBACK_SECTION_TITLES: Record<SectionKey, string> = {
  morning: "오전",
  lunch: "점심",
  afternoon: "오후",
  dinner: "저녁",
  night: "밤",
};

type DayTitleMap = Map<number, string>;

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim();
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function extractDayTitles(markdown: string): DayTitleMap {
  const titles = new Map<number, string>();
  let match: RegExpExecArray | null;

  DAY_HEADER_PATTERN.lastIndex = 0;
  while ((match = DAY_HEADER_PATTERN.exec(markdown)) !== null) {
    const dayNum = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isInteger(dayNum) || dayNum <= 0) continue;
    const title = normalizeText(match[2]) || "일정";
    titles.set(dayNum, title);
  }

  return titles;
}

function buildTripId(input: StoredItinerary): string {
  if (normalizeText(input.localId)) {
    return `trip:${normalizeText(input.localId)}`;
  }

  const fingerprint = [
    input.payload.country,
    input.payload.city,
    String(input.payload.nights),
    input.generatedAt,
    input.markdown,
  ].join("|");

  return `trip:${hashString(fingerprint)}`;
}

function buildDayId(dayNumber: number): string {
  return `day-${dayNumber}`;
}

function buildSectionId(dayNumber: number, sectionKey: SectionKey): TripSectionId {
  return `${buildDayId(dayNumber)}:${sectionKey}`;
}

function buildFallbackPlaceId(
  dayNumber: number,
  sectionKey: SectionKey,
  place: FinalPlace,
  occurrence: number
): string {
  const fingerprint = [
    String(dayNumber),
    sectionKey,
    normalizeText(place.name),
    normalizeText(place.address),
    Number.isFinite(place.lat) ? String(place.lat) : "",
    Number.isFinite(place.lng) ? String(place.lng) : "",
    String(occurrence),
  ].join("|");

  return `place:${hashString(fingerprint)}`;
}

function buildPlaceId(
  dayNumber: number,
  sectionKey: SectionKey,
  place: FinalPlace,
  occurrenceCounter: Map<string, number>
): string {
  const existingPlaceId = normalizeText(place.placeId);
  if (existingPlaceId) {
    return `place:${existingPlaceId}`;
  }

  const dedupeKey = [
    String(dayNumber),
    sectionKey,
    normalizeText(place.name),
    normalizeText(place.address),
    Number.isFinite(place.lat) ? String(place.lat) : "",
    Number.isFinite(place.lng) ? String(place.lng) : "",
  ].join("|");
  const occurrence = (occurrenceCounter.get(dedupeKey) ?? 0) + 1;
  occurrenceCounter.set(dedupeKey, occurrence);

  return buildFallbackPlaceId(dayNumber, sectionKey, place, occurrence);
}

function mapPlacesToTripPlaces(dayNumber: number, sectionKey: SectionKey, places: FinalPlace[]): TripPlace[] {
  const occurrenceCounter = new Map<string, number>();

  return places.map((place) => ({
    ...place,
    id: buildPlaceId(dayNumber, sectionKey, place, occurrenceCounter),
  }));
}

function getStructuredSection(
  structuredPlan: StructuredPlan | undefined,
  dayNumber: number,
  sectionKey: SectionKey
): StructuredSection | undefined {
  return structuredPlan?.days.find((day) => day.day === dayNumber)?.sections.find((section) => section.key === sectionKey);
}

function getFinalSection(
  finalItinerary: FinalItinerary | undefined,
  dayNumber: number,
  sectionKey: SectionKey
): FinalSection | undefined {
  return finalItinerary?.days.find((day) => day.day === dayNumber)?.sections.find((section) => section.key === sectionKey);
}

function resolveSectionStatus(): TripSectionStatus {
  return "ready";
}

function toTripSection(
  dayNumber: number,
  sectionKey: SectionKey,
  structuredSection: StructuredSection | undefined,
  finalSection: FinalSection | undefined
): TripSection {
  const title =
    normalizeText(finalSection?.title) ||
    normalizeText(structuredSection?.title) ||
    FALLBACK_SECTION_TITLES[sectionKey];
  const intent = normalizeText(finalSection?.intent) || normalizeText(structuredSection?.intent);
  const areaHint = normalizeText(finalSection?.areaHint) || normalizeText(structuredSection?.areaHint) || undefined;
  const durationMinutes = finalSection?.durationMinutes ?? structuredSection?.durationMinutes ?? 120;
  const foodRequired = finalSection?.foodRequired ?? structuredSection?.foodRequired ?? (sectionKey === "lunch" || sectionKey === "dinner");
  const places = mapPlacesToTripPlaces(dayNumber, sectionKey, finalSection?.places ?? []);

  return {
    id: buildSectionId(dayNumber, sectionKey),
    key: sectionKey,
    title,
    intent,
    areaHint,
    durationMinutes,
    foodRequired,
    status: resolveSectionStatus(),
    places,
  };
}

function collectDayNumbers(input: StoredItinerary, markdownTitles: DayTitleMap): number[] {
  const dayNumbers = new Set<number>();

  for (const day of input.structuredPlan?.days ?? []) {
    if (Number.isInteger(day.day) && day.day > 0) dayNumbers.add(day.day);
  }

  for (const day of input.finalItinerary?.days ?? []) {
    if (Number.isInteger(day.day) && day.day > 0) dayNumbers.add(day.day);
  }

  for (const dayNum of Array.from(markdownTitles.keys())) {
    dayNumbers.add(dayNum);
  }

  for (const key of Object.keys(input.dayMemos ?? {})) {
    const dayNum = Number.parseInt(key, 10);
    if (Number.isInteger(dayNum) && dayNum > 0) dayNumbers.add(dayNum);
  }

  if (dayNumbers.size === 0) {
    const fallbackDays = Math.max(1, (input.payload.nights ?? 0) + 1);
    for (let day = 1; day <= fallbackDays; day += 1) {
      dayNumbers.add(day);
    }
  }

  return Array.from(dayNumbers).sort((a, b) => a - b);
}

function toTripDay(input: StoredItinerary, dayNumber: number, markdownTitles: DayTitleMap): TripDay {
  const memo = normalizeText(input.dayMemos?.[String(dayNumber)]) || undefined;
  const title = normalizeText(markdownTitles.get(dayNumber)) || "일정";
  const sections = FIXED_SECTION_KEYS.map((sectionKey) =>
    toTripSection(
      dayNumber,
      sectionKey,
      getStructuredSection(input.structuredPlan, dayNumber, sectionKey),
      getFinalSection(input.finalItinerary, dayNumber, sectionKey)
    )
  );

  return {
    id: buildDayId(dayNumber),
    dayNumber,
    title,
    memo,
    sections,
  };
}

export function toTripDocument(input: StoredItinerary): TripDocument {
  const markdownTitles = extractDayTitles(input.markdown);
  const dayNumbers = collectDayNumbers(input, markdownTitles);
  const meta: TripMeta = {
    ...input.payload,
  };

  return {
    id: buildTripId(input),
    revision: 0,
    meta,
    days: dayNumbers.map((dayNumber) => toTripDay(input, dayNumber, markdownTitles)),
  };
}

export function getTripDayId(dayNumber: number): string {
  return buildDayId(dayNumber);
}

export function getTripSectionId(dayNumber: number, sectionKey: SectionKey): TripSectionId {
  return buildSectionId(dayNumber, sectionKey);
}
