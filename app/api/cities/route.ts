import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET(request: NextRequest) {
  const country = request.nextUrl.searchParams.get("country");
  if (!country?.trim()) {
    return NextResponse.json({ error: "country required" }, { status: 400 });
  }

  try {
    const code = country.trim().toUpperCase();
    const filePath = path.join(process.cwd(), "data", "cities", `${code}.json`);
    const raw = await fs.readFile(filePath, "utf-8");
    const cities = JSON.parse(raw);
    const slim = Array.isArray(cities)
      ? cities.map((c) => ({ name: c.name, nameKo: c.nameKo, lat: c.lat, lon: c.lon }))
      : [];
    return NextResponse.json({ cities: slim });
  } catch (e) {
    console.error("Cities API error:", e);
    return NextResponse.json({ cities: [] });
  }
}
