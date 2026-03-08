export type SectionKey = "morning" | "lunch" | "afternoon" | "dinner" | "night";

export interface StructuredSection {
  key: SectionKey;
  title: string;
  intent: string;
  areaHint?: string;
  durationMinutes?: number;
  foodRequired?: boolean;
}

export interface StructuredDay {
  day: number;
  sections: StructuredSection[];
}

export interface StructuredPlan {
  days: StructuredDay[];
}

export interface FinalPlace {
  name: string;
  lat: number;
  lng: number;
  rating: number;
  address?: string;
  placeId?: string;
  mapsUrl?: string;
  openingHours?: string[];
  travelToNext?: {
    distanceMeters: number;
    estimatedMinutes: number;
  };
}

export interface FinalSection {
  key: SectionKey;
  title: string;
  intent: string;
  areaHint?: string;
  durationMinutes?: number;
  foodRequired?: boolean;
  places: FinalPlace[];
}

export interface FinalDay {
  day: number;
  sections: FinalSection[];
}

export interface FinalItinerary {
  days: FinalDay[];
}
