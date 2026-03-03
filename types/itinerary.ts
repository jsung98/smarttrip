export interface Activity {
  name: string;
  type: "attraction" | "food" | "cafe";
  description?: string | null;
  stayMinutes: number;
  moveMinutesToNext: number;
  rating: number;
  lat?: number;
  lng?: number;
  mapUrl: string;
  directionsUrl: string;
}

export interface DayPlan {
  day: number;
  theme: string;
  summary?: string | null;
  activities: Activity[];
}

export interface ItineraryResponse {
  days: DayPlan[];
}
