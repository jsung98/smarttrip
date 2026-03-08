import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getClientId, rateLimit } from "@/lib/rateLimit";
import { isSectionKey } from "@/lib/types";
import type { SectionKey } from "@/types/plan";

const ALLOWED_SECTIONS = [
  "오전",
  "점심",
  "오후",
  "저녁",
  "밤",
  "아침 일정",
  "점심 일정",
  "저녁 일정",
  "점심 식사 장소 추천",
  "저녁 식사 장소 추천",
];

const SECTION_KEY_TO_TITLE: Record<SectionKey, string> = {
  morning: "오전",
  lunch: "점심",
  afternoon: "오후",
  dinner: "저녁",
  night: "밤",
};

const SECTION_TITLE_TO_KEY: Record<string, SectionKey> = Object.entries(SECTION_KEY_TO_TITLE).reduce(
  (acc, [key, title]) => {
    acc[title] = key as SectionKey;
    return acc;
  },
  {} as Record<string, SectionKey>
);

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function POST(request: NextRequest) {
  const clientId = getClientId(request.headers);
  const limit = rateLimit(`regenerate-section:${clientId}`, { windowMs: 60_000, max: 8 });
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
    dayNumber: number;
    sectionKey?: SectionKey;
    sectionTitle: string;
    dayMarkdown?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

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
    dayNumber,
    sectionKey,
    sectionTitle,
    dayMarkdown = "",
  } = body;

  if (!country?.trim() || !city?.trim()) {
    return NextResponse.json(
      { error: "국가와 도시가 필요합니다." },
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

  const day = Number(dayNumber);
  if (!Number.isInteger(day) || day < 1 || day > numNights + 1) {
    return NextResponse.json(
      { error: "유효한 날짜(1~일수)를 입력해 주세요." },
      { status: 400 }
    );
  }

  if (!sectionTitle?.trim() || !ALLOWED_SECTIONS.includes(sectionTitle)) {
    return NextResponse.json(
      { error: "유효한 섹션명을 입력해 주세요." },
      { status: 400 }
    );
  }

  const resolvedSectionKey = isSectionKey(sectionKey)
    ? sectionKey
    : SECTION_TITLE_TO_KEY[sectionTitle.trim()];

  if (!resolvedSectionKey) {
    return NextResponse.json(
      { error: "유효한 섹션 키를 입력해 주세요." },
      { status: 400 }
    );
  }

  const styleList = travelStyles?.length ? (travelStyles as string[]).join(", ") : "일반 관광";

  const prompt = `당신은 전문 여행 플래너입니다. 아래 일정 중 **Day ${day}**의 **### ${sectionTitle}** 섹션만 새로 작성해 주세요.

**목적지:** ${city}, ${country}
**여행 스타일:** ${styleList}
**예산 모드:** ${budgetMode}
**동행 유형:** ${companionType}
**일정 템포:** ${pace}
**희망 활동 시간:** ${dayStartHour}:00 ~ ${dayEndHour}:00

**기존 Day ${day} 일정 (참고용):**
\`\`\`
${dayMarkdown.slice(0, 3000)}
\`\`\`

**요청:** 아래 규칙을 지켜 JSON 객체를 출력해 주세요.
- JSON 스키마: { "markdown": string, "intent": string }
- markdown은 반드시 "### ${sectionTitle}"로 시작
- 각 섹션에 구체적인 장소 2~3곳 (점심/저녁 1~2곳)
- 점심/저녁이면 반드시 실제 음식점 상호명을 포함
- 섹션명이 "점심 식사 장소 추천" 또는 "저녁 식사 장소 추천"이면 음식점 상호명만 포함
- 카페 섹션/항목이면 실제 카페 상호명만 포함
- 가짜/임시 이름(예: 식당1, 카페1) 금지
- 각 장소에는 **권장 체류 시간** 또는 **방문 팁** 포함
- 각 장소 설명에 특징(대표 메뉴/분위기/볼거리) 1줄 포함
- 이동 시간은 간단히 포함
- 링크는 반드시 https:// 로 시작하는 실제 URL만 사용
  (필요 시 https://www.google.com/maps/search/?api=1&query=장소명+도시)
- intent는 25자 내외의 짧은 섹션 테마 문장
다른 설명 없이 JSON 객체만 출력하세요.`;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "요청한 JSON 객체만 출력합니다. markdown과 intent를 모두 채웁니다. 서두나 결론 없이 한국어로 작성합니다.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "";
    const cleaned = stripCodeFence(raw);

    let markdown = "";
    let intent = "";

    try {
      const parsed = JSON.parse(cleaned) as { markdown?: string; intent?: string };
      markdown = typeof parsed.markdown === "string" ? parsed.markdown.trim() : "";
      intent = typeof parsed.intent === "string" ? parsed.intent.trim() : "";
    } catch {
      markdown = raw.trim();
    }

    if (!markdown) {
      return NextResponse.json({ error: "섹션 생성 결과가 비어 있습니다." }, { status: 500 });
    }

    if (!intent) {
      intent = `${SECTION_KEY_TO_TITLE[resolvedSectionKey]} 추천 코스`;
    }

    return NextResponse.json({ markdown, sectionKey: resolvedSectionKey, intent });
  } catch (err) {
    console.error("OpenAI regenerate-section error:", err);
    const message =
      err instanceof Error ? err.message : "해당 섹션 생성에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
