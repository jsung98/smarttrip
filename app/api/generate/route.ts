import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getClientId, rateLimit } from "@/lib/rateLimit";

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

  let depthInstruction: string;
  if (nights <= 2) {
    depthInstruction =
      "핵심 명소 위주로 구성하고, 이동 동선을 짧게 유지해 주세요.";
  } else if (nights <= 4) {
    depthInstruction =
      "주요 관광지 외에 숨은 명소를 1~2개 포함해 주세요.";
  } else {
    depthInstruction =
      "근교 또는 당일치기 추천을 최소 1개 포함해 주세요.";
  }

  return `당신은 전문 여행 플래너입니다. 날짜별 일정을 마크다운으로 작성해 주세요. **전체 응답은 반드시 한국어로 작성**해 주세요.

**목적지:** ${city}, ${country}
**일수:** ${days}일 (${nights}박)
**여행 스타일:** ${styleList}
**예산 모드:** ${budgetMode}
**동행 유형:** ${companionType}
**일정 템포:** ${pace}
**희망 활동 시간:** ${dayStartHour}:00 ~ ${dayEndHour}:00

**작성 규칙:**
- 출력은 반드시 유효한 마크다운만. 서두나 요약 문장 없이 본문부터 시작.
- 각 날짜는 다음 섹션으로 구성: ## Day N - [테마/제목], 이후 ### 오전, ### 점심, ### 오후, ### 저녁, ### 밤(선택).
- 각 활동은: 장소명, 짧은 설명, 다음 이동지까지 **예상 이동 시간**을 포함.
- 각 섹션에는 **구체적인 장소 2~3곳**을 포함해 주세요. (점심/저녁은 1~2곳)
- 각 장소에는 **권장 체류 시간** 또는 **방문 팁(베스트 타임/예약 팁)** 중 하나를 포함해 주세요.
- ${depthInstruction}
- 하루 일정은 위 활동 시간 범위 안에서 무리하지 않게 구성.
- ${pace === "여유" ? "여유로운 이동과 휴식 시간을 충분히 포함." : pace === "빡빡" ? "핵심 명소를 더 촘촘히 구성하되 현실적인 이동 시간은 반드시 반영." : "관광과 휴식을 균형 있게 배치."}
- ${budgetMode === "가성비" ? "무료/저비용 명소와 합리적 식당 비중을 높이세요." : budgetMode === "프리미엄" ? "예약 가치가 있는 시그니처 장소/식당을 일부 포함하세요." : "중간 가격대 중심으로 구성하세요."}
- ${companionType === "아이동반" ? "아이 동반 기준으로 이동/대기 부담이 적고 화장실/휴식 포인트를 고려." : "동행 유형에 맞는 분위기와 활동 강도를 반영."}
- 장소는 지리적으로 묶어 이동을 최소화.
- 식사, 관광, 자유 시간을 균형 있게 구성.
- 링크는 반드시 **실제 유효한 URL**만 사용하고, https:// 로 시작해야 합니다. 추측이 필요한 경우에는 Google Maps 검색 링크를 사용하세요. (예: https://www.google.com/maps/search/?api=1&query=장소명+도시)

형식 예시:
## Day 1 - 바다 산책과 미식
### 오전
- **해변 산책로** 아침 산책과 뷰 포인트. [Google 지도](https://maps.google.com/...) **이동 15분**
### 점심
- **현지 맛집** 대표 메뉴 소개. [공식 사이트](https://...)
### 오후
...
`;
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
          content: "여행 일정은 마크다운으로만 출력합니다. 서두나 결론 문장은 쓰지 않습니다. 한국어로 작성합니다.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    const markdown =
      completion.choices[0]?.message?.content?.trim() ||
      "*일정을 생성하지 못했습니다.*";

    return NextResponse.json({ markdown });
  } catch (err) {
    console.error("OpenAI API error:", err);
    const message =
      err instanceof Error ? err.message : "일정 생성에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}



