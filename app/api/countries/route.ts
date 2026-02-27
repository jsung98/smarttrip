import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "data", "countries.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const countries = JSON.parse(raw);
    const slim = Array.isArray(countries)
      ? countries.map((c) => ({ code: c.code, name: c.name, nameKo: c.nameKo }))
      : [];
    return NextResponse.json({ countries: slim });
  } catch (e) {
    console.error("Countries API error:", e);
    return NextResponse.json({ error: "국가 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}
