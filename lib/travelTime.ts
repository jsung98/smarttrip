import type { DayPlan } from "@/types/itinerary";

export function getDayTimeTotals(day: DayPlan): {
  totalStay: number;
  totalMove: number;
  totalMinutes: number;
  moveRatio: number;
} {
  const totalStay = day.activities.reduce((sum, activity) => sum + activity.stayMinutes, 0);
  const totalMove = day.activities.reduce((sum, activity) => sum + activity.moveMinutesToNext, 0);
  const totalMinutes = totalStay + totalMove;
  const moveRatio = totalMinutes > 0 ? totalMove / totalMinutes : 0;
  return { totalStay, totalMove, totalMinutes, moveRatio };
}
