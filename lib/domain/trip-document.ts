import type { TripFormData } from "@/lib/types";
import type { FinalPlace, SectionKey } from "@/types/plan";

export type TripId = string;
export type TripRevision = number;
export type TripDayId = string;
export type TripSectionId = string;
export type TripPlaceId = string;

export type TripSectionStatus = "ready" | "regenerating" | "dirty" | "error";

export interface TripPlace extends FinalPlace {
  id: TripPlaceId;
}

export interface TripSection {
  id: TripSectionId;
  key: SectionKey;
  title: string;
  intent: string;
  areaHint?: string;
  durationMinutes: number;
  foodRequired: boolean;
  status: TripSectionStatus;
  places: TripPlace[];
}

export interface TripDay {
  id: TripDayId;
  dayNumber: number;
  title: string;
  memo?: string;
  sections: TripSection[];
}

export interface TripMeta extends TripFormData {}

export interface TripDocument {
  id: TripId;
  revision: TripRevision;
  meta: TripMeta;
  days: TripDay[];
}
