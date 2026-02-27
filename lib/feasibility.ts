import type { DayPlan } from "@/types/itinerary";
import { getDayTimeTotals } from "@/lib/travelTime";

export function analyzeStructuredDay(day: DayPlan) {
  const { totalStay, totalMove, totalMinutes, moveRatio } = getDayTimeTotals(day);
  const warnings: string[] = [];

  if (totalMinutes > 720) warnings.push("하루 총 일정이 12시간을 초과합니다.");
  if (totalMove > 240) warnings.push("하루 이동 시간이 과도합니다.");
  if (totalMinutes > 0 && moveRatio > 0.4) warnings.push("이동 비율이 높아 일정이 비효율적일 수 있습니다.");
  if (day.activities.length >= 10) warnings.push("활동 수가 많아 일정이 빡빡할 수 있습니다.");

  return {
    totalStay,
    totalMove,
    totalMinutes,
    moveRatio,
    warnings,
  };
}
