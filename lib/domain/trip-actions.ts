import type {
  TripDay,
  TripDayId,
  TripDocument,
  TripPlaceId,
  TripRevision,
  TripSection,
  TripSectionId,
  TripSectionStatus,
} from "@/lib/domain/trip-document";

export interface TripActionMeta {
  baseRevision?: TripRevision;
}

export interface HydrateTripAction extends TripActionMeta {
  type: "hydrate";
  document: TripDocument;
}

export interface ReplaceDayTripAction extends TripActionMeta {
  type: "replaceDay";
  dayId: TripDayId;
  day: TripDay;
}

export interface ReplaceSectionTripAction extends TripActionMeta {
  type: "replaceSection";
  dayId: TripDayId;
  sectionId: TripSectionId;
  section: TripSection;
}

export interface ReorderDaysTripAction extends TripActionMeta {
  type: "reorderDays";
  dayIds: TripDayId[];
}

export interface UpdateDayTitleTripAction extends TripActionMeta {
  type: "updateDayTitle";
  dayId: TripDayId;
  title: string;
}

export interface UpdateSectionIntentTripAction extends TripActionMeta {
  type: "updateSectionIntent";
  dayId: TripDayId;
  sectionId: TripSectionId;
  intent: string;
}

export interface MarkSectionStatusTripAction extends TripActionMeta {
  type: "markSectionStatus";
  dayId: TripDayId;
  sectionId: TripSectionId;
  status: TripSectionStatus;
}

export interface SetDayMemoTripAction extends TripActionMeta {
  type: "setDayMemo";
  dayId: TripDayId;
  memo?: string;
}

export interface ReplacePlacesTripAction extends TripActionMeta {
  type: "replacePlaces";
  dayId: TripDayId;
  sectionId: TripSectionId;
  places: TripSection["places"];
}

export interface RemovePlaceTripAction extends TripActionMeta {
  type: "removePlace";
  dayId: TripDayId;
  sectionId: TripSectionId;
  placeId: TripPlaceId;
}

export type TripAction =
  | HydrateTripAction
  | ReplaceDayTripAction
  | ReplaceSectionTripAction
  | ReorderDaysTripAction
  | UpdateDayTitleTripAction
  | UpdateSectionIntentTripAction
  | MarkSectionStatusTripAction
  | SetDayMemoTripAction
  | ReplacePlacesTripAction
  | RemovePlaceTripAction;
