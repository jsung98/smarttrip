import type { ItineraryResponse } from "@/types/itinerary";
import type {
  FinalItinerary,
  FinalPlace,
  FinalSection,
  SectionKey,
  StructuredPlan,
  StructuredSection,
} from "@/types/plan";

export const TRAVEL_STYLES = [
  "문화·역사",
  "맛집·음식",
  "자연·아웃도어",
  "쇼핑·라이프",
  "휴식",
  "바다",
  "모험",
  "사진·인생샷",
] as const;

export const BUDGET_MODES = ["가성비", "보통", "프리미엄"] as const;
export const COMPANION_TYPES = ["혼자", "커플", "친구", "가족", "아이동반"] as const;
export const PACE_MODES = ["여유", "보통", "빡빡"] as const;

export type TravelStyle = (typeof TRAVEL_STYLES)[number];
export type BudgetMode = (typeof BUDGET_MODES)[number];
export type CompanionType = (typeof COMPANION_TYPES)[number];
export type PaceMode = (typeof PACE_MODES)[number];

export interface TripPreferences {
  budgetMode: BudgetMode;
  companionType: CompanionType;
  pace: PaceMode;
  dayStartHour: number;
  dayEndHour: number;
  cityLat?: number;
  cityLon?: number;
  cityEn?: string;
  countryCode?: string;
}

export const DEFAULT_TRIP_PREFERENCES: TripPreferences = {
  budgetMode: "보통",
  companionType: "친구",
  pace: "보통",
  dayStartHour: 9,
  dayEndHour: 21,
};

export interface TripFormData extends TripPreferences {
  country: string;
  city: string;
  nights: number;
  travelStyles: TravelStyle[];
}

export interface ItineraryPayload extends TripPreferences {
  country: string;
  city: string;
  nights: number;
  travelStyles: string[];
}

export interface StoredItinerary {
  markdown: string;
  itinerary?: ItineraryResponse;
  structuredPlan?: StructuredPlan;
  finalItinerary?: FinalItinerary;
  dayMemos?: Record<string, string>;
  schemaVersion?: 1 | 2;
  payload: TripFormData;
  generatedAt: string;
  localId?: string;
  savedAt?: string;
}

export const FIXED_SECTION_KEYS: SectionKey[] = ["morning", "lunch", "afternoon", "dinner", "night"];

const DEFAULT_SECTION_TITLES: Record<SectionKey, string> = {
  morning: "오전",
  lunch: "점심",
  afternoon: "오후",
  dinner: "저녁",
  night: "밤",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === "string" && (FIXED_SECTION_KEYS as string[]).includes(value);
}

function normalizeDurationMinutes(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded <= 0) return undefined;
  return rounded;
}

function defaultStructuredSection(key: SectionKey): StructuredSection {
  return {
    key,
    title: DEFAULT_SECTION_TITLES[key],
    intent: "",
    durationMinutes: 120,
    foodRequired: key === "lunch" || key === "dinner",
  };
}

function normalizeStructuredSection(input: unknown, fallbackKey: SectionKey): StructuredSection {
  const base = defaultStructuredSection(fallbackKey);
  if (!isRecord(input)) return base;

  const key = isSectionKey(input.key) ? input.key : fallbackKey;
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : DEFAULT_SECTION_TITLES[key];
  const intent = typeof input.intent === "string" ? input.intent.trim() : "";
  const areaHint = typeof input.areaHint === "string" && input.areaHint.trim() ? input.areaHint.trim() : undefined;
  const durationMinutes = normalizeDurationMinutes(input.durationMinutes) ?? base.durationMinutes;
  const defaultFoodRequired = key === "lunch" || key === "dinner";
  const foodRequired = typeof input.foodRequired === "boolean" ? input.foodRequired : defaultFoodRequired;

  return {
    key,
    title,
    intent,
    areaHint,
    durationMinutes,
    foodRequired,
  };
}

export function normalizeStructuredPlan(input: unknown): StructuredPlan | undefined {
  if (!isRecord(input) || !Array.isArray(input.days)) return undefined;

  const days = input.days
    .filter(isRecord)
    .map((dayRecord, idx) => {
      const dayNum = typeof dayRecord.day === "number" && Number.isInteger(dayRecord.day) ? dayRecord.day : idx + 1;
      const rawSections = Array.isArray(dayRecord.sections) ? dayRecord.sections : [];

      const byKey = new Map<SectionKey, StructuredSection>();
      for (const sectionInput of rawSections) {
        if (!isRecord(sectionInput)) continue;
        const key = isSectionKey(sectionInput.key) ? sectionInput.key : undefined;
        if (!key) continue;
        byKey.set(key, normalizeStructuredSection(sectionInput, key));
      }

      // Always return exactly 5 sections in fixed key order.
      const sections = FIXED_SECTION_KEYS.map((key) => byKey.get(key) ?? defaultStructuredSection(key));
      return { day: dayNum, sections };
    });

  if (days.length === 0) return undefined;
  return { days };
}

function normalizeFinalPlace(input: unknown): FinalPlace | null {
  if (!isRecord(input)) return null;
  if (typeof input.name !== "string" || !input.name.trim()) return null;
  if (typeof input.lat !== "number" || !Number.isFinite(input.lat)) return null;
  if (typeof input.lng !== "number" || !Number.isFinite(input.lng)) return null;
  if (typeof input.rating !== "number" || !Number.isFinite(input.rating)) return null;

  const openingHours = Array.isArray(input.openingHours)
    ? input.openingHours
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : undefined;

  let travelToNext: FinalPlace["travelToNext"] | undefined;
  if (isRecord(input.travelToNext)) {
    const distanceMeters = input.travelToNext.distanceMeters;
    const estimatedMinutes = input.travelToNext.estimatedMinutes;
    if (
      typeof distanceMeters === "number" &&
      Number.isFinite(distanceMeters) &&
      typeof estimatedMinutes === "number" &&
      Number.isFinite(estimatedMinutes)
    ) {
      travelToNext = {
        distanceMeters,
        estimatedMinutes,
      };
    }
  }

  return {
    name: input.name.trim(),
    lat: input.lat,
    lng: input.lng,
    rating: input.rating,
    address: typeof input.address === "string" && input.address.trim() ? input.address.trim() : undefined,
    placeId: typeof input.placeId === "string" && input.placeId.trim() ? input.placeId.trim() : undefined,
    mapsUrl: typeof input.mapsUrl === "string" && input.mapsUrl.trim() ? input.mapsUrl.trim() : undefined,
    openingHours: openingHours && openingHours.length > 0 ? openingHours : undefined,
    travelToNext,
  };
}

function normalizeFinalSection(input: unknown): FinalSection | null {
  if (!isRecord(input)) return null;
  if (!isSectionKey(input.key)) return null;

  const key = input.key;
  const title =
    typeof input.title === "string" && input.title.trim() ? input.title.trim() : DEFAULT_SECTION_TITLES[key];
  const intent = typeof input.intent === "string" ? input.intent.trim() : "";
  const areaHint = typeof input.areaHint === "string" && input.areaHint.trim() ? input.areaHint.trim() : undefined;
  const durationMinutes = normalizeDurationMinutes(input.durationMinutes);
  const defaultFoodRequired = key === "lunch" || key === "dinner";
  const foodRequired = typeof input.foodRequired === "boolean" ? input.foodRequired : defaultFoodRequired;
  const places = Array.isArray(input.places) ? input.places.map(normalizeFinalPlace).filter((x): x is FinalPlace => !!x) : [];

  return {
    key,
    title,
    intent,
    areaHint,
    durationMinutes,
    foodRequired,
    places,
  };
}

export function normalizeFinalItinerary(input: unknown): FinalItinerary | undefined {
  if (!isRecord(input) || !Array.isArray(input.days)) return undefined;

  const days = input.days
    .filter(isRecord)
    .map((dayRecord, idx) => {
      const dayNum = typeof dayRecord.day === "number" && Number.isInteger(dayRecord.day) ? dayRecord.day : idx + 1;
      const rawSections = Array.isArray(dayRecord.sections) ? dayRecord.sections : [];

      const byKey = new Map<SectionKey, FinalSection>();
      for (const sectionInput of rawSections) {
        const normalized = normalizeFinalSection(sectionInput);
        if (!normalized) continue;
        byKey.set(normalized.key, normalized);
      }

      // Drop invalid keys and keep fixed order only.
      const sections = FIXED_SECTION_KEYS.map((key) => byKey.get(key)).filter((x): x is FinalSection => !!x);
      return { day: dayNum, sections };
    })
    .filter((day) => day.sections.length > 0);

  if (days.length === 0) return undefined;
  return { days };
}

export function normalizeStoredItinerary(input: unknown): StoredItinerary | null {
  if (!isRecord(input)) return null;
  if (typeof input.markdown !== "string") return null;
  if (!isRecord(input.payload)) return null;

  const payload = normalizeTripPayload(input.payload as Partial<TripFormData> & Pick<TripFormData, "country" | "city" | "nights">);
  const generatedAt = typeof input.generatedAt === "string" && input.generatedAt.trim() ? input.generatedAt : new Date().toISOString();
  const structuredPlan = normalizeStructuredPlan(input.structuredPlan);
  const finalItinerary = normalizeFinalItinerary(input.finalItinerary);
  const dayMemos = isRecord(input.dayMemos)
    ? Object.fromEntries(
        Object.entries(input.dayMemos)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value.length > 0)
      )
    : undefined;
  const schemaVersion: 1 | 2 = structuredPlan || finalItinerary ? 2 : 1;

  return {
    markdown: input.markdown,
    itinerary: input.itinerary as ItineraryResponse | undefined,
    structuredPlan,
    finalItinerary,
    dayMemos: dayMemos && Object.keys(dayMemos).length > 0 ? dayMemos : undefined,
    schemaVersion,
    payload,
    generatedAt,
    localId: typeof input.localId === "string" ? input.localId : undefined,
    savedAt: typeof input.savedAt === "string" ? input.savedAt : undefined,
  };
}

export function normalizeTripPayload(
  payload: Partial<TripFormData> & Pick<TripFormData, "country" | "city" | "nights">
): TripFormData {
  return {
    ...DEFAULT_TRIP_PREFERENCES,
    ...payload,
    travelStyles: Array.isArray(payload.travelStyles) ? payload.travelStyles : [],
  };
}
