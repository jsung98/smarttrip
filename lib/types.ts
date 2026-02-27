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
  payload: TripFormData;
  generatedAt: string;
  localId?: string;
  savedAt?: string;
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
