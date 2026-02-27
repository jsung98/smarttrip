import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getClientId, rateLimit } from "@/lib/rateLimit";
import type { Activity, DayPlan, ItineraryResponse } from "@/types/itinerary";

function buildPrompt(payload: {
  country: string;
  city: string;
  nights: number;
  travelStyles: string[];
  budgetMode?: string;
  companionType?: string;
  pace?: string;
  dayStartHour?: number;
  dayEndHour?: number;
}): string {
  const {
    country,
    city,
    nights,
    travelStyles,
    budgetMode = "보통",
    companionType = "친구",
    pace = "보통",
    dayStartHour = 9,
    dayEndHour = 21,
  } = payload;
  const days = nights + 1;
  const styleList = travelStyles.length ? travelStyles.join(", ") : "일반 관광";

  return `당신은 전문 여행 플래너입니다. 목적지 여행 일정을 반드시 JSON으로만 출력하세요.

목적지: ${city}, ${country}
일수: ${days}일 (${nights}박)
여행 스타일: ${styleList}
예산 모드: ${budgetMode}
동행 유형: ${companionType}
일정 템포: ${pace}
희망 활동 시간: ${dayStartHour}:00 ~ ${dayEndHour}:00

규칙:
- 오직 JSON 객체만 출력하고, 마크다운/설명/코드블록을 절대 포함하지 마세요.
- days 배열의 길이는 ${days}여야 합니다.
- 각 활동은 stayMinutes(체류 시간)와 moveMinutesToNext(다음 장소 이동 시간)를 반드시 숫자로 포함합니다.
- 마지막 활동의 moveMinutesToNext는 반드시 0입니다.
- stayMinutes는 30 이상 240 이하의 현실적인 값으로 작성합니다.
- moveMinutesToNext는 0 이상 180 이하의 현실적인 값으로 작성합니다.
- lat/lng는 알 수 있는 경우에만 숫자로 포함하세요.
- 전체 일정은 현실적인 동선으로 구성하세요.`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeActivity(input: Activity, isLast: boolean): Activity {
  const stayMinutes = Math.max(30, Math.min(240, Math.round(input.stayMinutes)));
  const moveMinutesToNext = isLast ? 0 : Math.max(0, Math.min(180, Math.round(input.moveMinutesToNext)));

  const next: Activity = {
    name: input.name.trim(),
    type: input.type.trim() || "attraction",
    stayMinutes,
    moveMinutesToNext,
  };

  if (isFiniteNumber(input.lat)) next.lat = input.lat;
  if (isFiniteNumber(input.lng)) next.lng = input.lng;
  return next;
}

function parseItineraryResponse(raw: string): ItineraryResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.days)) return null;

  const days: DayPlan[] = [];
  for (const dayItem of record.days) {
    if (!dayItem || typeof dayItem !== "object") return null;
    const d = dayItem as Record<string, unknown>;

    if (!isFiniteNumber(d.day) || !Number.isInteger(d.day)) return null;
    if (typeof d.theme !== "string") return null;
    if (!Array.isArray(d.activities)) return null;

    const activities: Activity[] = [];
    for (let i = 0; i < d.activities.length; i++) {
      const activityItem = d.activities[i];
      if (!activityItem || typeof activityItem !== "object") return null;
      const a = activityItem as Record<string, unknown>;

      if (typeof a.name !== "string" || !a.name.trim()) return null;
      if (typeof a.type !== "string" || !a.type.trim()) return null;
      if (!isFiniteNumber(a.stayMinutes)) return null;
      if (!isFiniteNumber(a.moveMinutesToNext)) return null;

      const rawActivity: Activity = {
        name: a.name,
        type: a.type,
        stayMinutes: a.stayMinutes,
        moveMinutesToNext: a.moveMinutesToNext,
        lat: isFiniteNumber(a.lat) ? a.lat : undefined,
        lng: isFiniteNumber(a.lng) ? a.lng : undefined,
      };
      activities.push(sanitizeActivity(rawActivity, i === d.activities.length - 1));
    }

    days.push({ day: d.day, theme: d.theme.trim(), activities });
  }

  return { days };
}

function getSectionIndex(index: number, total: number): number {
  if (total <= 1) return 0;
  const ratio = index / (total - 1);
  if (ratio < 0.2) return 0;
  if (ratio < 0.45) return 1;
  if (ratio < 0.75) return 2;
  if (ratio < 0.95) return 3;
  return 4;
}

function isMealType(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized.includes("food") || normalized.includes("meal") || normalized.includes("restaurant");
}

function buildMapLink(activity: Activity): string {
  const q = isFiniteNumber(activity.lat) && isFiniteNumber(activity.lng)
    ? encodeURIComponent(`${activity.name} ${activity.lat},${activity.lng}`)
    : encodeURIComponent(activity.name);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function buildMarkdownFromDay(day: DayPlan): string {
  const sectionTitles = ["오전", "점심", "오후", "저녁", "밤"];
  const buckets: Activity[][] = [[], [], [], [], []];
  const mealActivities = day.activities.filter((activity) => isMealType(activity.type));
  const nonMealActivities = day.activities.filter((activity) => !isMealType(activity.type));

  // Keep meals anchored to lunch/dinner sections.
  if (mealActivities.length > 0) buckets[1].push(mealActivities[0]);
  if (mealActivities.length > 1) buckets[3].push(mealActivities[1]);
  for (let i = 2; i < mealActivities.length; i++) {
    buckets[i % 2 === 0 ? 1 : 3].push(mealActivities[i]);
  }

  // Spread non-meal activities across morning/afternoon/night to reduce long gaps.
  const coreSections = [0, 2, 4];
  nonMealActivities.forEach((activity, index) => {
    buckets[coreSections[index % coreSections.length]].push(activity);
  });

  const requiredSections = [0, 1, 2, 3];
  const lines: string[] = [`## Day ${day.day} - ${day.theme || `Day ${day.day}`}`];

  for (const sectionIndex of requiredSections) {
    lines.push(`### ${sectionTitles[sectionIndex]}`);
    const items = buckets[sectionIndex];
    if (!items.length) {
      lines.push(sectionIndex === 1 || sectionIndex === 3 ? "- 식사 장소를 추가해 주세요" : "- 이동 및 휴식 시간을 확보하세요");
      continue;
    }
    for (const activity of items) {
      const link = buildMapLink(activity);
      lines.push(
        `- **${activity.name}** (${activity.type}) 체류 ${activity.stayMinutes}분 · 이동 ${activity.moveMinutesToNext}분 · [지도](${link})`
      );
    }
  }

  if (buckets[4].length > 0) {
    lines.push("### 밤");
    for (const activity of buckets[4]) {
      const link = buildMapLink(activity);
      lines.push(
        `- **${activity.name}** (${activity.type}) 체류 ${activity.stayMinutes}분 · 이동 ${activity.moveMinutesToNext}분 · [지도](${link})`
      );
    }
  }

  return lines.join("\n");
}

function buildMarkdownFromItinerary(itinerary: ItineraryResponse): string {
  return itinerary.days
    .slice()
    .sort((a, b) => a.day - b.day)
    .map((day) => buildMarkdownFromDay(day))
    .join("\n\n");
}

export async function POST(request: NextRequest) {
  const clientId = getClientId(request.headers);
  const limit = rateLimit(`generate:${clientId}`, { windowMs: 60_000, max: 5 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 }
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI API 키가 설정되어 있지 않습니다." },
      { status: 500 }
    );
  }

  let body: {
    country: string;
    city: string;
    nights: number;
    travelStyles: string[];
    budgetMode?: string;
    companionType?: string;
    pace?: string;
    dayStartHour?: number;
    dayEndHour?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { country, city, nights, travelStyles, budgetMode, companionType, pace, dayStartHour, dayEndHour } = body;
  if (!country?.trim() || !city?.trim()) {
    return NextResponse.json(
      { error: "국가와 도시를 입력해 주세요." },
      { status: 400 }
    );
  }
  const numNights = Number(nights);
  if (!Number.isInteger(numNights) || numNights < 1 || numNights > 14) {
    return NextResponse.json(
      { error: "숙박 일수는 1~14 사이로 입력해 주세요." },
      { status: 400 }
    );
  }

  const prompt = buildPrompt({
    country: country.trim(),
    city: city.trim(),
    nights: numNights,
    travelStyles: Array.isArray(travelStyles) ? travelStyles : [],
    budgetMode,
    companionType,
    pace,
    dayStartHour: Number.isFinite(Number(dayStartHour)) ? Number(dayStartHour) : undefined,
    dayEndHour: Number.isFinite(Number(dayEndHour)) ? Number(dayEndHour) : undefined,
  });

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "반드시 JSON 객체만 출력하세요. 마크다운, 코드블록, 설명 문장은 금지입니다.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 3000,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "itinerary_response",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              days: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    day: { type: "integer" },
                    theme: { type: "string" },
                    activities: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          name: { type: "string" },
                          type: { type: "string" },
                          stayMinutes: { type: "number" },
                          moveMinutesToNext: { type: "number" },
                          lat: { type: ["number", "null"] },
                          lng: { type: ["number", "null"] },
                        },
                        required: ["name", "type", "stayMinutes", "moveMinutesToNext", "lat", "lng"],
                      },
                    },
                  },
                  required: ["day", "theme", "activities"],
                },
              },
            },
            required: ["days"],
          },
        },
      },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "";
    const itinerary = parseItineraryResponse(raw);
    if (!itinerary || itinerary.days.length === 0) {
      return NextResponse.json({ error: "일정 생성 결과를 파싱하지 못했습니다." }, { status: 500 });
    }

    const markdown = buildMarkdownFromItinerary(itinerary);
    return NextResponse.json({ itinerary, markdown });
  } catch (err) {
    console.error("OpenAI API error:", err);
    const message =
      err instanceof Error ? err.message : "일정 생성에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
