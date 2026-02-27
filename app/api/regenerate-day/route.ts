import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getClientId, rateLimit } from "@/lib/rateLimit";

export async function POST(request: NextRequest) {
  const clientId = getClientId(request.headers);
  const limit = rateLimit(`regenerate-day:${clientId}`, { windowMs: 60_000, max: 8 });
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
    existingMarkdown: string;
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
    existingMarkdown,
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

  const styleList = travelStyles?.length ? (travelStyles as string[]).join(", ") : "일반 관광";

  const prompt = `당신은 전문 여행 플래너입니다. 아래 일정 중 **Day ${day}** 부분만 새로 작성해 주세요.

**목적지:** ${city}, ${country}
**여행 스타일:** ${styleList}
**예산 모드:** ${budgetMode}
**동행 유형:** ${companionType}
**일정 템포:** ${pace}
**희망 활동 시간:** ${dayStartHour}:00 ~ ${dayEndHour}:00

**기존 일정 (참고용 / Day ${day}만 새로 작성):**
\`\`\`
${(existingMarkdown || "").slice(0, 3000)}
\`\`\`

**요청:** Day ${day}의 일정만 마크다운으로 출력해 주세요. 반드시 "## Day ${day} - ..."로 시작하고, ### 오전, ### 점심, ### 오후, ### 저녁, ### 밤(선택) 형식을 지켜 주세요.
- 각 섹션에 **구체적인 장소 2~3곳**을 포함해 주세요. (점심/저녁은 1~2곳)
- 각 장소에는 **권장 체류 시간** 또는 **방문 팁**을 포함해 주세요.
- 활동 시간 범위를 크게 벗어나지 않도록 현실적으로 구성해 주세요.
- 링크는 반드시 **실제 유효한 URL**만 사용하고, https:// 로 시작해야 합니다. 추측이 필요한 경우에는 Google Maps 검색 링크를 사용하세요.
  (예: https://www.google.com/maps/search/?api=1&query=장소명+도시)
  장소에는 [텍스트](URL) 형태의 링크를 포함하고, 한국어로만 작성해 주세요.
다른 설명 없이 해당 Day 블록만 출력하세요.`;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "여행 일정은 해당 Day 블록만 마크다운으로 출력합니다. 서두나 결론은 쓰지 않고 한국어로 작성합니다.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 1400,
    });

    const block = completion.choices[0]?.message?.content?.trim() || "";

    return NextResponse.json({ markdown: block });
  } catch (err) {
    console.error("OpenAI regenerate-day error:", err);
    const message =
      err instanceof Error ? err.message : "해당 날짜 생성에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


