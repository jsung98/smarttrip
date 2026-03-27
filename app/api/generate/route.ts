import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getClientId, rateLimit } from "@/lib/rateLimit";
import { isSectionKey, normalizeStructuredPlan } from "@/lib/types";
import type { ItineraryResponse, DayPlan, Activity } from "@/types/itinerary";
import type { SectionKey, StructuredPlan, StructuredSection } from "@/types/plan";

type GenerateRequest = {
  country?: string;
  city?: string;
  nights?: number;
  travelStyles?: string[];
  budgetMode?: string;
  companionType?: string;
  pace?: string;
  dayStartHour?: number;
  dayEndHour?: number;
};

type RawSection = Record<string, unknown>;
type RawPlan = {
  days?: unknown;
};

type ControlledGenerateErrorCode = "OPENAI_RESPONSE_TRUNCATED" | "OPENAI_INVALID_JSON";

class ControlledGenerateError extends Error {
  code: ControlledGenerateErrorCode;

  constructor(code: ControlledGenerateErrorCode, message: string) {
    super(message);
    this.name = "ControlledGenerateError";
    this.code = code;
  }
}

const SECTION_TITLES: Record<SectionKey, string> = {
  morning: "오전",
  lunch: "점심",
  afternoon: "오후",
  dinner: "저녁",
  night: "밤",
};

const SECTION_DEFAULT_DURATION: Record<SectionKey, number> = {
  morning: 180,
  lunch: 90,
  afternoon: 180,
  dinner: 90,
  night: 120,
};

const PARSE_ERROR_MESSAGE = "일정 구조 파싱에 실패했습니다. 다시 시도해 주세요.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clampDuration(value: unknown, key: SectionKey): number {
  const fallback = SECTION_DEFAULT_DURATION[key];
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(30, Math.min(600, n));
}

function normalizeIntent(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || "일반 관광";
}

function normalizeAreaHint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 100);
}

function normalizeFoodRequired(value: unknown, key: SectionKey): boolean {
  if (typeof value === "boolean") return value;
  return key === "lunch" || key === "dinner";
}

function sanitizeSection(rawSection: RawSection): StructuredSection | null {
  const key = rawSection.key;
  if (!isSectionKey(key)) return null;

  const section: StructuredSection = {
    key,
    title: SECTION_TITLES[key],
    intent: normalizeIntent(rawSection.intent),
    durationMinutes: clampDuration(rawSection.durationMinutes, key),
    foodRequired: normalizeFoodRequired(rawSection.foodRequired, key),
  };

  const areaHint = normalizeAreaHint(rawSection.areaHint);
  if (areaHint) section.areaHint = areaHint;

  return section;
}

function sanitizeStructuredPlan(rawPlan: RawPlan): StructuredPlan {
  const rawDays = Array.isArray(rawPlan.days) ? rawPlan.days : [];
  const days: StructuredPlan["days"] = [];

  for (const rawDay of rawDays) {
    if (!isRecord(rawDay)) continue;

    const rawSections = Array.isArray(rawDay.sections) ? rawDay.sections : [];
    const sections: StructuredSection[] = [];

    for (const section of rawSections) {
      if (!isRecord(section)) continue;
      const sanitized = sanitizeSection(section);
      if (sanitized) sections.push(sanitized);
    }

    days.push({
      day: days.length + 1,
      sections,
    });
  }

  return { days };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseRawPlan(content: string): RawPlan {
  const cleaned = stripCodeFence(content);
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("invalid_root");
    }
    return parsed as RawPlan;
  } catch (error) {
    console.error("Generate JSON parse failed:", {
      error: error instanceof Error ? error.message : String(error),
      rawResponse: content,
      cleanedResponse: cleaned,
    });
    throw new ControlledGenerateError("OPENAI_INVALID_JSON", PARSE_ERROR_MESSAGE);
  }
}

function sectionToMarkdown(section: StructuredSection): string {
  const lines: string[] = [];
  lines.push(`### ${SECTION_TITLES[section.key]}`);
  lines.push(`- 의도: ${section.intent}`);
  if (section.areaHint) lines.push(`- 권장 권역: ${section.areaHint}`);
  if (typeof section.durationMinutes === "number") lines.push(`- 권장 체류: ${section.durationMinutes}분`);
  if (section.foodRequired) lines.push("- 식사 섹션: 예");
  return lines.join("\n");
}

function buildMarkdownFromStructuredPlan(plan: StructuredPlan): string {
  return plan.days
    .map((day) => {
      const sectionsText = day.sections.map(sectionToMarkdown).join("\n\n");
      return `## Day ${day.day} - 일정\n\n${sectionsText}`;
    })
    .join("\n\n");
}

function sectionToLegacyActivity(section: StructuredSection): Activity {
  const isFood = section.key === "lunch" || section.key === "dinner";
  const isCafe = section.key === "night";

  return {
    name: `${SECTION_TITLES[section.key]} 일정`,
    type: isFood ? "food" : isCafe ? "cafe" : "attraction",
    description: section.intent,
    stayMinutes: section.durationMinutes ?? SECTION_DEFAULT_DURATION[section.key],
    moveMinutesToNext: 20,
    rating: 0,
    lat: 0,
    lng: 0,
    mapUrl: "",
    directionsUrl: "",
  };
}

function buildLegacyItineraryFromStructuredPlan(plan: StructuredPlan): ItineraryResponse {
  const days: DayPlan[] = plan.days.map((day) => ({
    day: day.day,
    theme: "맞춤 일정",
    summary: day.sections.map((section) => section.intent).filter(Boolean).join(" · ") || null,
    activities: day.sections.map(sectionToLegacyActivity),
  }));

  return { days };
}

function buildPrompt(input: Required<Pick<GenerateRequest, "country" | "city" | "nights">> & GenerateRequest): string {
  const styleList =
    Array.isArray(input.travelStyles) && input.travelStyles.length > 0 ? input.travelStyles.join(", ") : "일반 관광";

  return [
    "당신은 여행 일정 구조 설계 보조 시스템입니다.",
    "반드시 JSON만 출력하세요. 설명 문장, 마크다운, 코드블록 금지.",
    "",
    `목적지: ${input.city}, ${input.country}`,
    `여행일수: ${input.nights + 1}일`,
    `여행 스타일: ${styleList}`,
    `예산 모드: ${input.budgetMode ?? "보통"}`,
    `동행 유형: ${input.companionType ?? "친구"}`,
    `일정 템포: ${input.pace ?? "보통"}`,
    `활동 시간: ${input.dayStartHour ?? 9}:00 ~ ${input.dayEndHour ?? 21}:00`,
    "",
    "출력 스키마:",
    "{",
    '  "days": [',
    "    {",
    '      "day": 1,',
    '      "sections": [',
    '        { "key": "morning", "title": "오전", "intent": "string", "areaHint": "string", "durationMinutes": 180, "foodRequired": false },',
    '        { "key": "lunch", "title": "점심", "intent": "string", "areaHint": "string", "durationMinutes": 90, "foodRequired": true },',
    '        { "key": "afternoon", "title": "오후", "intent": "string", "areaHint": "string", "durationMinutes": 180, "foodRequired": false },',
    '        { "key": "dinner", "title": "저녁", "intent": "string", "areaHint": "string", "durationMinutes": 90, "foodRequired": true },',
    '        { "key": "night", "title": "밤", "intent": "string", "areaHint": "string", "durationMinutes": 120, "foodRequired": false }',
    "      ]",
    "    }",
    "  ]",
    "}",
    "",
    "규칙:",
    "- day마다 sections는 반드시 5개(morning,lunch,afternoon,dinner,night).",
    "- 장소명(name), 좌표(lat/lng), 평점(rating), 주소, 링크, placeId 생성 금지.",
    "- intent는 활동 의도만 작성.",
  ].join("\n");
}

async function requestStructuredPlan(openai: OpenAI, body: GenerateRequest, country: string, city: string, nights: number) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.5,
    max_tokens: 2200,
    messages: [
      {
        role: "system",
        content:
          "반드시 StructuredPlan JSON만 출력한다. 장소명, 좌표, 평점, 링크를 생성하지 않는다. key는 morning,lunch,afternoon,dinner,night만 사용한다.",
      },
      {
        role: "user",
        content: buildPrompt({ ...body, country, city, nights }),
      },
    ],
  });

  const choice = completion.choices[0];
  if (choice?.finish_reason === "length") {
    console.error("OpenAI generate truncated response:", {
      finishReason: choice.finish_reason,
      rawResponse: choice.message?.content ?? "",
    });
    throw new ControlledGenerateError("OPENAI_RESPONSE_TRUNCATED", PARSE_ERROR_MESSAGE);
  }

  return choice?.message?.content?.trim() || "";
}

async function requestStructuredPlanWithRetry(
  openai: OpenAI,
  body: GenerateRequest,
  country: string,
  city: string,
  nights: number
): Promise<RawPlan> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await requestStructuredPlan(openai, body, country, city, nights);
      return parseRawPlan(text);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof ControlledGenerateError &&
        (error.code === "OPENAI_RESPONSE_TRUNCATED" || error.code === "OPENAI_INVALID_JSON");

      console.warn("Generate attempt failed:", {
        attempt: attempt + 1,
        retrying: retryable && attempt === 0,
        error: error instanceof Error ? error.message : String(error),
      });

      if (!retryable || attempt === 1) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("unknown_generate_error");
}

export async function POST(request: NextRequest) {
  const clientId = getClientId(request.headers);
  const limit = rateLimit(`generate:${clientId}`, { windowMs: 60_000, max: 8 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API 키가 설정되어 있지 않습니다." }, { status: 500 });
  }

  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const country = typeof body.country === "string" ? body.country.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const nights = Number(body.nights);
  if (!country || !city) {
    return NextResponse.json({ error: "국가와 도시는 필수입니다." }, { status: 400 });
  }
  if (!Number.isInteger(nights) || nights < 1 || nights > 14) {
    return NextResponse.json({ error: "숙박 일수는 1~14 사이로 입력해 주세요." }, { status: 400 });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const rawPlan = await requestStructuredPlanWithRetry(openai, body, country, city, nights);

    if (!Array.isArray(rawPlan.days)) {
      return NextResponse.json({ error: PARSE_ERROR_MESSAGE }, { status: 500 });
    }
    if (rawPlan.days.length === 0) {
      return NextResponse.json({ error: PARSE_ERROR_MESSAGE }, { status: 500 });
    }

    const sanitized = sanitizeStructuredPlan(rawPlan);
    if (sanitized.days.length === 0) {
      return NextResponse.json({ error: PARSE_ERROR_MESSAGE }, { status: 500 });
    }

    const structuredPlan = normalizeStructuredPlan(sanitized);
    if (!structuredPlan) {
      return NextResponse.json({ error: PARSE_ERROR_MESSAGE }, { status: 500 });
    }

    const markdown = buildMarkdownFromStructuredPlan(structuredPlan);
    const itinerary = buildLegacyItineraryFromStructuredPlan(structuredPlan);

    return NextResponse.json({ structuredPlan, markdown, itinerary });
  } catch (err) {
    console.error("OpenAI generate error:", err);
    if (err instanceof ControlledGenerateError) {
      return NextResponse.json({ error: PARSE_ERROR_MESSAGE, code: err.code }, { status: 502 });
    }
    return NextResponse.json({ error: PARSE_ERROR_MESSAGE }, { status: 500 });
  }
}
