import type { TripAction } from "@/lib/domain/trip-actions";
import type {
  TripDay,
  TripDayId,
  TripDocument,
  TripSection,
  TripSectionId,
} from "@/lib/domain/trip-document";

function isRevisionMismatch(state: TripDocument, action: TripAction): boolean {
  return typeof action.baseRevision === "number" && action.baseRevision !== state.revision;
}

function bumpRevision(state: TripDocument): TripDocument {
  return {
    ...state,
    revision: state.revision + 1,
  };
}

function replaceDayById(days: TripDay[], dayId: TripDayId, nextDay: TripDay): TripDay[] | null {
  const index = days.findIndex((day) => day.id === dayId);
  if (index < 0) return null;

  const currentDay = days[index];
  if (currentDay === nextDay) return days;

  const nextDays = days.slice();
  nextDays[index] = nextDay;
  return nextDays;
}

function replaceSectionById(
  days: TripDay[],
  dayId: TripDayId,
  sectionId: TripSectionId,
  nextSection: TripSection
): TripDay[] | null {
  const dayIndex = days.findIndex((day) => day.id === dayId);
  if (dayIndex < 0) return null;

  const currentDay = days[dayIndex];
  const sectionIndex = currentDay.sections.findIndex((section) => section.id === sectionId);
  if (sectionIndex < 0) return null;

  const currentSection = currentDay.sections[sectionIndex];
  if (currentSection === nextSection) return days;

  const nextSections = currentDay.sections.slice();
  nextSections[sectionIndex] = nextSection;

  const nextDay: TripDay = {
    ...currentDay,
    sections: nextSections,
  };

  const nextDays = days.slice();
  nextDays[dayIndex] = nextDay;
  return nextDays;
}

function reorderDaysByIds(days: TripDay[], orderedDayIds: TripDayId[]): TripDay[] | null {
  if (orderedDayIds.length !== days.length) return null;

  const byId = new Map(days.map((day) => [day.id, day] as const));
  const reordered = orderedDayIds.map((dayId) => byId.get(dayId)).filter((day): day is TripDay => !!day);
  if (reordered.length !== days.length) return null;

  const nextDays = reordered.map((day, index) => {
    const nextDayNumber = index + 1;
    if (day.dayNumber === nextDayNumber) return day;
    return {
      ...day,
      dayNumber: nextDayNumber,
    };
  });

  const isSameOrder = nextDays.every((day, index) => day === days[index]);
  return isSameOrder ? days : nextDays;
}

export function tripReducer(state: TripDocument, action: TripAction): TripDocument {
  if (action.type === "hydrate") {
    return action.document;
  }

  if (isRevisionMismatch(state, action)) {
    return state;
  }

  switch (action.type) {
    case "replaceDay": {
      const nextDays = replaceDayById(state.days, action.dayId, action.day);
      if (!nextDays || nextDays === state.days) return state;
      return bumpRevision({
        ...state,
        days: nextDays,
      });
    }

    case "replaceSection": {
      const nextDays = replaceSectionById(state.days, action.dayId, action.sectionId, action.section);
      if (!nextDays || nextDays === state.days) return state;
      return bumpRevision({
        ...state,
        days: nextDays,
      });
    }

    case "reorderDays": {
      const nextDays = reorderDaysByIds(state.days, action.dayIds);
      if (!nextDays || nextDays === state.days) return state;
      return bumpRevision({
        ...state,
        days: nextDays,
      });
    }

    default:
      return state;
  }
}
