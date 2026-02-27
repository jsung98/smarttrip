export interface Activity {
  name: string;
  type: string;
  stayMinutes: number;
  moveMinutesToNext: number;
  lat?: number;
  lng?: number;
}

export interface DayPlan {
  day: number;
  theme: string;
  activities: Activity[];
}

export interface ItineraryResponse {
  days: DayPlan[];
}
