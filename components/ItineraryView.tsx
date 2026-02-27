"use client";

import { useMemo, useState, useCallback, Fragment, useEffect } from "react";
import Link from "next/link";
import ItineraryMap, { type MapPoint } from "@/components/ItineraryMap";
import { saveAndActivateItinerary } from "@/lib/localItineraryStore";
import { normalizeTripPayload, type StoredItinerary } from "@/lib/types";

function MarkdownBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="prose prose-slate max-w-none prose-headings:font-semibold prose-p:text-slate-700 prose-ul:my-2 prose-li:my-0.5 prose-strong:text-slate-900 prose-a:text-violet-600 prose-a:no-underline hover:prose-a:underline">
      {children}
    </div>
  );
}

type Segment = { type: "text"; value: string } | { type: "link"; text: string; url: string };

function parseLinks(s: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) segments.push({ type: "text", value: s.slice(last, m.index) });
    segments.push({ type: "link", text: m[1], url: m[2] });
    last = m.index + m[0].length;
  }
  if (last < s.length) segments.push({ type: "text", value: s.slice(last) });
  return segments.length ? segments : [{ type: "text", value: s }];
}

function parseBoldItalic(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let idx = 0;
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > idx) parts.push(text.slice(idx, m.index));
    parts.push(m[1] !== undefined ? <strong key={parts.length}>{m[1]}</strong> : <em key={parts.length}>{m[2]}</em>);
    idx = m.index + m[0].length;
  }
  if (idx < text.length) parts.push(text.slice(idx));
  return parts.length ? parts : [text];
}

function sanitizeUrl(url: string): string | null {
  let trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("www.")) trimmed = `https://${trimmed}`;
  if (/^(maps\.google\.com|google\.com\/maps)/i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  if (/^(tripadvisor\.com|wikivoyage\.org|timeout\.com)/i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function renderInline(content: string): React.ReactNode[] {
  const segments = parseLinks(content);
  const out: React.ReactNode[] = [];
  segments.forEach((seg, segIdx) => {
    if (seg.type === "link") {
      const safe = sanitizeUrl(seg.url);
      if (safe) {
        out.push(
          <a key={segIdx} href={safe} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">
            {seg.text}
          </a>
        );
      } else {
        out.push(<span key={segIdx}>{seg.text}</span>);
      }
    } else {
      parseBoldItalic(seg.value).forEach((node, i) => {
        out.push(<Fragment key={`${segIdx}-${i}`}>{node}</Fragment>);
      });
    }
  });
  return out.length ? out : [content];
}

function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) {
      nodes.push(
        <h2 key={key++} className="mt-8 mb-3 text-xl font-semibold text-slate-900 first:mt-0">
          {trimmed.slice(3)}
        </h2>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      nodes.push(
        <h3 key={key++} className="mt-4 mb-2 text-base font-semibold text-violet-800">
          {trimmed.slice(4)}
        </h3>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const content = trimmed.slice(2);
      const parts = renderInline(content);
      nodes.push(
        <li key={key++} className="ml-4 list-disc text-slate-700">
          {parts.length ? parts : content}
        </li>
      );
      i++;
      continue;
    }

    if (trimmed) {
      const parts = renderInline(trimmed);
      nodes.push(
        <p key={key++} className="text-slate-700">
          {parts.length > 1 ? parts : parts[0] ?? trimmed}
        </p>
      );
    }
    i++;
  }

  return nodes;
}

const DAY_HEADER_PATTERN = "^## Day (\\d+)\\s*(?:-|\\u2013|\\u2014|\\u00B7)\\s*(.+)$";

function extractDaySections(markdown: string): { dayNum: number; title: string; raw: string }[] {
  const sections: { dayNum: number; title: string; raw: string }[] = [];
  const re = new RegExp(DAY_HEADER_PATTERN, "gm");
  let m: RegExpExecArray | null;
  let last: { dayNum: number; title: string; start: number } | null = null;
  while ((m = re.exec(markdown)) !== null) {
    if (last) {
      sections.push({
        dayNum: last.dayNum,
        title: last.title,
        raw: markdown.slice(last.start, m.index).trimEnd(),
      });
    }
    last = { dayNum: parseInt(m[1], 10), title: m[2], start: m.index };
  }
  if (last) {
    sections.push({
      dayNum: last.dayNum,
      title: last.title,
      raw: markdown.slice(last.start).trimEnd(),
    });
  }
  return sections;
}

function findDayRange(markdown: string, dayNum: number): { start: number; end: number; raw: string } | null {
  const re = new RegExp(DAY_HEADER_PATTERN, "gm");
  const matches: Array<{ dayNum: number; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    matches.push({ dayNum: parseInt(m[1], 10), start: m.index });
  }

  const idx = matches.findIndex((d) => d.dayNum === dayNum);
  if (idx < 0) return null;

  const start = matches[idx].start;
  const end = idx + 1 < matches.length ? matches[idx + 1].start : markdown.length;
  return { start, end, raw: markdown.slice(start, end).trimEnd() };
}

function replaceDayInMarkdown(markdown: string, dayNum: number, newBlock: string): string {
  const range = findDayRange(markdown, dayNum);
  if (!range) return markdown;
  const header = range.raw.split("\n")[0] || `## Day ${dayNum}`;
  const newBody = newBlock.replace(/^## Day \d+\s*(?:-|[\u2013\u2014\u00B7])\s*[^\n]+\n?/, "").trim();
  const replacement = `${header}\n${newBody}`.trimEnd();
  return `${markdown.slice(0, range.start)}${replacement}\n\n${markdown.slice(range.end)}`
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function stripDayHeader(block: string): string {
  return block.replace(/^## Day \d+\s*(?:-|[\u2013\u2014\u00B7])\s*[^\n]+\n?/, "").trim();
}

function replaceDayByRaw(markdown: string, dayNum: number, newBlock: string): string {
  const range = findDayRange(markdown, dayNum);
  if (!range) return markdown;
  const normalized = newBlock.trimEnd();
  return `${markdown.slice(0, range.start)}${normalized}\n\n${markdown.slice(range.end)}`
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function rebuildDaysSequential(markdown: string, removeDayNum?: number): string {
  const days = extractDaySections(markdown)
    .filter((d) => (removeDayNum ? d.dayNum !== removeDayNum : true))
    .sort((a, b) => a.dayNum - b.dayNum);

  const firstMatch = markdown.match(/^## Day \d+\s*(?:-|[\u2013\u2014\u00B7])\s*/m);
  const prefix = firstMatch ? markdown.slice(0, firstMatch.index).trimEnd() : "";

  const rebuilt = days.map((d, idx) => {
    const nextNum = idx + 1;
    const body = stripDayHeader(d.raw);
    return `## Day ${nextNum} - ${d.title}\n${body}`.trimEnd();
  });

  if (!rebuilt.length) return prefix;
  return prefix ? `${prefix}\n\n${rebuilt.join("\n\n")}\n` : `${rebuilt.join("\n\n")}\n`;
}

function removeDayFromMarkdown(markdown: string, dayNum: number): string {
  const range = findDayRange(markdown, dayNum);
  if (!range) return markdown;
  return `${markdown.slice(0, range.start)}${markdown.slice(range.end)}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function appendNoteToDay(markdown: string, dayNum: number, note: string): string {
  const clean = note.trim();
  if (!clean) return markdown;
  const range = findDayRange(markdown, dayNum);
  if (!range) return markdown;
  const lines = range.raw.split("\n");
  const header = lines[0] || `## Day ${dayNum}`;
  const body = lines.slice(1).join("\n");
  const nextBody = `${body.trimEnd()}\n\n### 메모\n- ${clean.replace(/\n+/g, " / ")}`.trimEnd();
  const replacement = `${header}\n${nextBody}`.trimEnd();
  return `${markdown.slice(0, range.start)}${replacement}\n\n${markdown.slice(range.end)}`
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function extractDaySubsections(raw: string): { title: string; raw: string }[] {
  const lines = raw.split("\n");
  const sections: { title: string; raw: string }[] = [];
  let currentTitle: string | null = null;
  let currentStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("### ")) {
      if (currentTitle !== null && currentStart >= 0) {
        sections.push({
          title: currentTitle,
          raw: lines.slice(currentStart, i).join("\n").trimEnd(),
        });
      }
      currentTitle = line.trim().slice(4).trim();
      currentStart = i;
    }
  }

  if (currentTitle !== null && currentStart >= 0) {
    sections.push({
      title: currentTitle,
      raw: lines.slice(currentStart).join("\n").trimEnd(),
    });
  }

  return sections;
}

const ALLOWED_SECTIONS = ["오전", "점심", "오후", "저녁", "밤"] as const;
const EMPTY_DAY_TEMPLATE = [
  "### 오전",
  "- 장소를 입력하세요",
  "### 점심",
  "- 장소를 입력하세요",
  "### 오후",
  "- 장소를 입력하세요",
  "### 저녁",
  "- 장소를 입력하세요",
].join("\n");

const TEMPLATE_SECTIONS = extractDaySubsections(EMPTY_DAY_TEMPLATE);
const TEMPLATE_SECTION_MAP = new Map(TEMPLATE_SECTIONS.map((s) => [s.title, s.raw]));

function normalizeDayRaw(raw: string): string {
  const sectionSet = new Set<string>(ALLOWED_SECTIONS as readonly string[]);
  const lines = raw.split("\n");
  const normalized = lines.map((line) => {
    const trimmed = line.trim();
    if (sectionSet.has(trimmed)) return `### ${trimmed}`;
    return line;
  });
  return normalized.join("\n");
}

function dedupeDaySections(sections: { title: string; raw: string }[]): { title: string; raw: string }[] {
  const allowedSet = new Set<string>(ALLOWED_SECTIONS as readonly string[]);
  const lastIndexByTitle = new Map<string, number>();
  sections.forEach((section, idx) => {
    if (allowedSet.has(section.title)) lastIndexByTitle.set(section.title, idx);
  });

  return sections.filter((section, idx) => {
    if (!allowedSet.has(section.title)) return true;
    return lastIndexByTitle.get(section.title) === idx;
  });
}

function cleanSectionBody(body: string, sectionTitle?: string): string {
  const sectionSet = new Set<string>(ALLOWED_SECTIONS as readonly string[]);
  const sectionTailChars = new Set(ALLOWED_SECTIONS.filter((title) => title.length > 1).map((title) => title.slice(-1)));
  if (sectionTitle && sectionTitle.length > 1) {
    sectionTailChars.add(sectionTitle.slice(-1));
  }
  const lines = body.split("\n");
  const cleaned: string[] = [];
  let prevTrimmed = "";
  let seenContent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      cleaned.push(line);
      prevTrimmed = "";
      continue;
    }

    // Some generated outputs leak a trailing syllable from the section title (e.g. "점심" -> "심")
    // as the first body line. Drop it before rendering/sanitizing.
    if (!seenContent && trimmed.length === 1 && sectionTailChars.has(trimmed)) {
      continue;
    }

    const normalizedTitle = trimmed.replace(/[:：\-–—]+$/, "").trim();
    if (sectionSet.has(normalizedTitle)) {
      prevTrimmed = normalizedTitle;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      const title = trimmed.slice(4).trim();
      if (sectionSet.has(title)) {
        prevTrimmed = title;
        continue;
      }
    }

    if (trimmed.length === 1 && prevTrimmed && prevTrimmed.endsWith(trimmed)) {
      continue;
    }

    cleaned.push(line);
    prevTrimmed = trimmed;
    seenContent = true;
  }

  return cleaned.join("\n").trim();
}

function sanitizeDayRaw(raw: string, dayNum: number): string {
  const normalizedRaw = normalizeDayRaw(raw);
  const lines = normalizedRaw.split("\n");
  const headerLine = lines[0]?.startsWith("## Day ") ? lines[0] : `## Day ${dayNum}`;

  let i = 1;
  const preambleLines: string[] = [];
  while (i < lines.length && !lines[i].trim().startsWith("### ")) {
    const trimmed = lines[i].trim();
    if (trimmed && !ALLOWED_SECTIONS.includes(trimmed as any)) {
      preambleLines.push(lines[i]);
    }
    i++;
  }

  const rawSections = dedupeDaySections(extractDaySubsections(normalizedRaw));
  const sectionMap = new Map<string, string>();
  for (const section of rawSections) {
    const body = section.raw.replace(/^###\s+.+?\n?/, "").trim();
    const cleaned = cleanSectionBody(body, section.title);
    sectionMap.set(section.title, cleaned);
  }

  const order = getAllowedSectionTitles(normalizedRaw);
  const sectionOrder = order.length ? order : TEMPLATE_SECTIONS.map((s) => s.title);
  const extraSections = rawSections.filter((section) => !ALLOWED_SECTIONS.includes(section.title as any));

  const nextSections = sectionOrder.map((title) => {
    const body = sectionMap.get(title);
    if (body) return `### ${title}\n${body}`.trim();
    const template = TEMPLATE_SECTION_MAP.get(title);
    return template ? template.trim() : `### ${title}`;
  });
  const extraSectionBlocks = extraSections.map((section) => {
    const body = section.raw.replace(/^###\s+.+?\n?/, "").trim();
    const cleaned = cleanSectionBody(body, section.title);
    return cleaned ? `### ${section.title}\n${cleaned}` : `### ${section.title}`;
  });

  const chunks: string[] = [headerLine];
  const preamble = preambleLines.join("\n").trimEnd();
  if (preamble) chunks.push(preamble);
  chunks.push(...nextSections);
  chunks.push(...extraSectionBlocks);
  return chunks.join("\n\n").trimEnd();
}

function clearDayInMarkdown(markdown: string, dayNum: number): string {
  const day = extractDaySections(markdown).find((d) => d.dayNum === dayNum);
  if (!day) return markdown;
  const newBlock = `## Day ${dayNum} - ${day.title}\n${EMPTY_DAY_TEMPLATE}`;
  const sanitized = sanitizeDayRaw(newBlock, dayNum);
  return replaceDayByRaw(markdown, dayNum, sanitized);
}

function getAllowedSectionTitles(raw: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const section of extractDaySubsections(raw)) {
    if (!ALLOWED_SECTIONS.includes(section.title as any)) continue;
    if (seen.has(section.title)) continue;
    seen.add(section.title);
    titles.push(section.title);
  }
  return titles;
}

function normalizeSectionBlock(block: string, sectionTitle: string): string {
  const normalized = block.replace(/\r\n/g, "\n").trim();
  if (!normalized) return `### ${sectionTitle}`;

  // Strip any full-day header that might slip in.
  const withoutDayHeader = normalized.replace(/^##\s*Day\s*\d+[\s\S]*?\n/, "").trim();
  const lines = withoutDayHeader.split("\n");
  const sectionSet = new Set<string>(ALLOWED_SECTIONS as readonly string[]);

  const isSectionLine = (line: string) => {
    const trimmed = line.trim();
    const headerMatch = /^###\s+(.+)$/.exec(trimmed);
    if (headerMatch) return { isSection: true, title: headerMatch[1].trim() };
    if (sectionSet.has(trimmed)) return { isSection: true, title: trimmed };
    return { isSection: false, title: "" };
  };

  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const info = isSectionLine(lines[i]);
    if (info.isSection && info.title === sectionTitle) {
      startIdx = i;
      break;
    }
  }

  const bodyLines: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const info = isSectionLine(lines[i]);
    if (i !== startIdx && info.isSection && info.title !== sectionTitle) break;
    if (i === startIdx && info.isSection && info.title === sectionTitle) continue;
    bodyLines.push(lines[i]);
  }

  const body = bodyLines.join("\n").trim();
  return body ? `### ${sectionTitle}\n${body}` : `### ${sectionTitle}`;
}

function replaceSectionInDay(markdown: string, dayNum: number, sectionTitle: string, newSectionBlock: string): string {
  const days = extractDaySections(markdown);
  const day = days.find((d) => d.dayNum === dayNum);
  if (!day) return markdown;

  const normalizedRaw = normalizeDayRaw(day.raw);
  const dayLines = normalizedRaw.split("\n");
  const headerLine = dayLines[0] || `## Day ${dayNum}`;
  let i = 1;
  const preambleLines: string[] = [];
  while (i < dayLines.length && !dayLines[i].trim().startsWith("### ")) {
    preambleLines.push(dayLines[i]);
    i++;
  }

  const sections = dedupeDaySections(extractDaySubsections(normalizedRaw));
  if (!sections.length) return markdown;

  const normalizedSection = normalizeSectionBlock(newSectionBlock, sectionTitle);

  let replaced = false;
  const nextSections = sections.map((s) => {
    if (s.title !== sectionTitle) return s.raw;
    replaced = true;
    return normalizedSection;
  });
  if (!replaced) {
    nextSections.push(normalizedSection);
  }

  const chunks: string[] = [headerLine];
  const preamble = preambleLines.join("\n").trimEnd();
  if (preamble) chunks.push(preamble);
  chunks.push(...nextSections);

  const rebuilt = chunks.join("\n\n").trimEnd();
  const sanitized = sanitizeDayRaw(rebuilt, dayNum);
  return replaceDayInMarkdown(markdown, dayNum, sanitized);
}

function analyzeDay(raw: string) {
  let moveMinutes = 0;
  const moveRegex = /이동\s*(\d+)\s*분/g;
  let moveMatch: RegExpExecArray | null;
  while ((moveMatch = moveRegex.exec(raw)) !== null) {
    moveMinutes += Number(moveMatch[1] || 0);
  }
  const itemCount = (raw.match(/^- /gm) || []).length;
  const sectionCount = (raw.match(/^### /gm) || []).length;
  const missingMoveHints = itemCount - (raw.match(/이동\s*\d+\s*분/g) || []).length;

  const warnings: string[] = [];
  if (itemCount >= 12) warnings.push("방문 장소가 많아 일정이 빡빡할 수 있어요.");
  if (moveMinutes >= 180) warnings.push("하루 총 이동 시간이 길어요.");
  if (sectionCount >= 6 && itemCount >= 10) warnings.push("섹션 수 대비 활동량이 많아요.");
  if (missingMoveHints >= 3) warnings.push("이동시간 표기가 부족해 현실성 판단이 어려워요.");

  return { moveMinutes, itemCount, warnings };
}

function getNightsFromMarkdown(markdown: string) {
  const days = extractDaySections(markdown).length;
  return Math.max(0, days - 1);
}

function DaySkeleton() {
  return (
    <div className="rounded-3xl border border-white/20 bg-white/90 p-6 shadow-xl backdrop-blur sm:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
        <div className="flex gap-2">
          <div className="h-8 w-20 animate-pulse rounded bg-slate-100" />
          <div className="h-8 w-24 animate-pulse rounded bg-slate-100" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  );
}

function formatManwon(value: number) {
  const man = value / 10000;
  const rounded = Number.isInteger(man) ? man.toFixed(0) : man.toFixed(1);
  return `${rounded}만원`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function scaleRange(range: { min: number; max: number }, multiplier: number) {
  return {
    min: Math.round(range.min * multiplier),
    max: Math.round(range.max * multiplier),
  };
}

function getBudgetBreakdown(input: {
  budgetMode: string;
  companionType: string;
  pace: string;
  dayStartHour: number;
  dayEndHour: number;
  travelStyles: string[];
  days: number;
}) {
  const base: Record<
    string,
    {
      lodging: { min: number; max: number };
      food: { min: number; max: number };
      transport: { min: number; max: number };
      activities: { min: number; max: number };
    }
  > = {
    가성비: {
      lodging: { min: 40000, max: 90000 },
      food: { min: 25000, max: 60000 },
      transport: { min: 10000, max: 25000 },
      activities: { min: 10000, max: 30000 },
    },
    보통: {
      lodging: { min: 80000, max: 160000 },
      food: { min: 40000, max: 90000 },
      transport: { min: 15000, max: 40000 },
      activities: { min: 20000, max: 60000 },
    },
    프리미엄: {
      lodging: { min: 180000, max: 350000 },
      food: { min: 70000, max: 150000 },
      transport: { min: 25000, max: 70000 },
      activities: { min: 40000, max: 120000 },
    },
  };

  const companionMult: Record<string, number> = {
    혼자: 1.0,
    커플: 0.9,
    친구: 0.95,
    가족: 1.05,
    아이동반: 1.1,
  };

  const paceMult: Record<string, number> = {
    여유: 0.95,
    보통: 1.0,
    빡빡: 1.1,
  };

  const activityStyleBoost =
    input.travelStyles.includes("쇼핑·라이프") || input.travelStyles.includes("모험")
      ? 1.1
      : input.travelStyles.includes("휴식")
      ? 0.95
      : 1.0;

  const hours = input.dayEndHour - input.dayStartHour;
  const hoursMult = clamp(hours / 10, 0.85, 1.2);

  const baseRange = base[input.budgetMode] || base["보통"];
  const comp = companionMult[input.companionType] ?? 1.0;
  const pace = paceMult[input.pace] ?? 1.0;

  const lodging = scaleRange(baseRange.lodging, comp);
  const food = scaleRange(baseRange.food, comp * (hoursMult >= 1.1 ? 1.05 : hoursMult <= 0.9 ? 0.95 : 1.0));
  const transport = scaleRange(baseRange.transport, comp * pace);
  const activities = scaleRange(baseRange.activities, comp * pace * activityStyleBoost);

  const perDayTotal = {
    min: lodging.min + food.min + transport.min + activities.min,
    max: lodging.max + food.max + transport.max + activities.max,
  };

  const total = {
    min: perDayTotal.min * input.days,
    max: perDayTotal.max * input.days,
  };

  return {
    perDay: perDayTotal,
    total,
    categories: { lodging, food, transport, activities },
  };
}

function extractPlaceCandidates(markdown: string): string[] {
  const candidates: string[] = [];
  const lines = markdown.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const boldMatch = trimmed.match(/\*\*([^*]+)\*\*/);
    if (boldMatch?.[1]) {
      candidates.push(boldMatch[1].trim());
      continue;
    }
    const plain = trimmed
      .replace(/^- /, "")
      .replace(/\[.*?\]\(.*?\)/g, "")
      .replace(/이동\s*\d+\s*분/g, "")
      .split(/[.·|-]/)[0]
      ?.trim();
    if (plain) candidates.push(plain);
  }
  return Array.from(new Set(candidates)).slice(0, 20);
}

type PlaceCandidate = {
  name: string;
  dayNum: number;
  order: number;
  section?: string;
};

function extractPlaceCandidatesWithMeta(markdown: string): PlaceCandidate[] {
  const days = extractDaySections(markdown);
  const all: PlaceCandidate[] = [];
  for (const day of days) {
    const lines = day.raw.split("\n");
    let section: string | undefined;
    let order = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("### ")) {
        section = trimmed.slice(4).trim();
        continue;
      }
      if (!/^[-*•]\s+/.test(trimmed) && !/\*\*[^*]+\*\*/.test(trimmed)) continue;
      const boldMatch = trimmed.match(/\*\*([^*]+)\*\*/);
      const linkMatch = trimmed.match(/\[([^\]]+)\]\(([^)]+)\)/);
      let name = "";
      if (boldMatch?.[1]) {
        name = boldMatch[1].trim();
      } else if (linkMatch?.[1]) {
        name = linkMatch[1].trim();
      } else {
        name = trimmed
          .replace(/^[-*•]\s+/, "")
          .replace(/\[.*?\]\(.*?\)/g, "")
          .replace(/이동\s*\d+\s*분/g, "")
          .split(/[.·|-]/)[0]
          ?.trim();
      }
      if (!name) continue;
      order += 1;
      all.push({
        name,
        dayNum: day.dayNum,
        order,
        section,
      });
    }
  }
  return all;
}

export default function ItineraryView({ data: initialData }: { data: StoredItinerary }) {
  const [data, setData] = useState<StoredItinerary>(() => ({
    ...initialData,
    payload: normalizeTripPayload(initialData.payload),
  }));
  const [regeneratingDay, setRegeneratingDay] = useState<number | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [kakaoReady, setKakaoReady] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editText, setEditText] = useState<string>("");
  const [noteEditingDay, setNoteEditingDay] = useState<number | null>(null);
  const [noteEditText, setNoteEditText] = useState<string>("");
  const [regeneratingSection, setRegeneratingSection] = useState<{
    dayNum: number;
    section: string;
  } | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapPoints, setMapPoints] = useState<MapPoint[]>([]);
  const [mapDay, setMapDay] = useState<number | "all" | null>(null);
  const [mapProvider, setMapProvider] = useState<string | null>(null);

  const persistItinerary = useCallback((next: StoredItinerary) => {
    const normalized: StoredItinerary = {
      ...next,
      payload: normalizeTripPayload(next.payload),
    };
    const saved = saveAndActivateItinerary(normalized);
    setData(saved);
    return saved;
  }, []);

  const replaceDay = useCallback(
    async (dayNum: number) => {
      setRegeneratingDay(dayNum);
      try {
        const res = await fetch("/api/regenerate-day", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            country: data.payload.country,
            city: data.payload.city,
            nights: data.payload.nights,
            travelStyles: data.payload.travelStyles,
            budgetMode: data.payload.budgetMode,
            companionType: data.payload.companionType,
            pace: data.payload.pace,
            dayStartHour: data.payload.dayStartHour,
            dayEndHour: data.payload.dayEndHour,
            dayNumber: dayNum,
            existingMarkdown: data.markdown,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          alert(json.error || "재생성에 실패했습니다.");
          return;
        }
        const newBlock = json.markdown?.trim() || "";
        if (!newBlock) {
          alert("재생성 결과가 비어 있습니다. 잠시 후 다시 시도해 주세요.");
          return;
        }
        let updated = replaceDayInMarkdown(data.markdown, dayNum, newBlock);
        if (!updated || updated === data.markdown) {
          updated = replaceDayByRaw(data.markdown, dayNum, sanitizeDayRaw(newBlock, dayNum));
        }
        if (!updated || updated === data.markdown) {
          alert("재생성 결과를 적용하지 못했습니다. Day 헤더 형식을 확인해 주세요.");
          return;
        }
        const next: StoredItinerary = { ...data, markdown: updated, generatedAt: new Date().toISOString() };
        persistItinerary(next);
      } catch {
        alert("네트워크 오류입니다.");
      } finally {
        setRegeneratingDay(null);
      }
    },
    [data, persistItinerary]
  );

  const rawDaySections = useMemo(() => extractDaySections(data.markdown), [data.markdown]);
  const daySections = useMemo(
    () =>
      rawDaySections.map((day) => ({
        ...day,
        displayRaw: sanitizeDayRaw(day.raw, day.dayNum),
      })),
    [rawDaySections]
  );
  const { city, country, nights, travelStyles, budgetMode, companionType, pace, dayStartHour, dayEndHour, cityLat, cityLon } =
    data.payload;
  const budgetEstimate = useMemo(
    () =>
      getBudgetBreakdown({
        budgetMode,
        companionType,
        pace,
        dayStartHour,
        dayEndHour,
        travelStyles,
        days: nights + 1,
      }),
    [budgetMode, companionType, pace, dayStartHour, dayEndHour, travelStyles, nights]
  );
  const feasibility = useMemo(() => {
    const byDay = daySections.map((section) => ({
      dayNum: section.dayNum,
      title: section.title,
      ...analyzeDay(section.displayRaw),
    }));
    const warnings = byDay.flatMap((d) => d.warnings.map((w) => `Day ${d.dayNum}: ${w}`));
    return { byDay, warnings };
  }, [daySections]);

  const mapDays = useMemo(() => {
    const days = Array.from(new Set(mapPoints.map((p) => p.dayNum ?? 1)));
    return days.sort((a, b) => a - b);
  }, [mapPoints]);

  useEffect(() => {
    if (!mapPoints.length) {
      if (mapDay !== null) setMapDay(null);
      return;
    }
    const firstDay = mapDays[0];
    if (firstDay === undefined) return;
    if (mapDay === null) {
      setMapDay(firstDay);
      return;
    }
    if (mapDay !== "all" && !mapDays.includes(mapDay)) {
      setMapDay(firstDay);
    }
  }, [mapDays, mapPoints.length, mapDay]);

  const replaceSection = useCallback(
    async (dayNum: number, sectionTitle: string) => {
      setRegeneratingSection({ dayNum, section: sectionTitle });
      try {
        const day = rawDaySections.find((d) => d.dayNum === dayNum);
        if (!day) return;
        const res = await fetch("/api/regenerate-section", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            country: data.payload.country,
            city: data.payload.city,
            nights: data.payload.nights,
            travelStyles: data.payload.travelStyles,
            budgetMode: data.payload.budgetMode,
            companionType: data.payload.companionType,
            pace: data.payload.pace,
            dayStartHour: data.payload.dayStartHour,
            dayEndHour: data.payload.dayEndHour,
            dayNumber: dayNum,
            sectionTitle,
            dayMarkdown: day.raw,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          alert(json.error || "섹션 재생성에 실패했습니다.");
          return;
        }
        const newBlock = json.markdown?.trim() || "";
        if (!newBlock) {
          alert("섹션 재생성 결과가 비어 있습니다. 잠시 후 다시 시도해 주세요.");
          return;
        }
        const updated = replaceSectionInDay(data.markdown, dayNum, sectionTitle, newBlock);
        if (!updated || updated === data.markdown) {
          alert("섹션 재생성 결과를 적용하지 못했습니다. Day 헤더 형식을 확인해 주세요.");
          return;
        }
        const next: StoredItinerary = { ...data, markdown: updated, generatedAt: new Date().toISOString() };
        persistItinerary(next);
      } catch {
        alert("네트워크 오류입니다.");
      } finally {
        setRegeneratingSection(null);
      }
    },
    [data, rawDaySections, persistItinerary]
  );

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage(successMessage);
      setTimeout(() => setCopyMessage(null), 2000);
    } catch {
      setCopyMessage("복사에 실패했습니다.");
      setTimeout(() => setCopyMessage(null), 2000);
    }
  };

  const createShareLink = async () => {
    if (shareLoading) return;
    setShareLoading(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: data.markdown,
          payload: data.payload,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.id) {
        setCopyMessage(json.error || "공유 링크 생성에 실패했습니다.");
        return;
      }
      const url = `${window.location.origin}/share/${json.id}`;
      setShareUrl(url);
      await copyText(url, "공유 링크를 복사했습니다.");
    } catch {
      setCopyMessage("공유 링크 생성에 실패했습니다.");
    } finally {
      setShareLoading(false);
    }
  };

  const ensureShareLink = async (): Promise<string | null> => {
    if (shareUrl) return shareUrl;
    if (shareLoading) return null;
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: data.markdown,
        payload: data.payload,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.id) return null;
    const url = `${window.location.origin}/share/${json.id}`;
    setShareUrl(url);
    return url;
  };

  const shareKakao = async () => {
    const Kakao = (window as any)?.Kakao;
    if (!Kakao || !Kakao.isInitialized()) {
      setCopyMessage("카카오 SDK가 준비되지 않았습니다.");
      setTimeout(() => setCopyMessage(null), 2000);
      return;
    }

    const url = (await ensureShareLink()) || shareUrl;
    if (!url) return;

    Kakao.Share.sendDefault({
      objectType: "text",
      text: `${city}, ${country} 여행 일정입니다.`,
      link: {
        mobileWebUrl: url,
        webUrl: url,
      },
    });
  };
  const addNoteToDay = (dayNum: number) => {
    setNoteEditingDay(dayNum);
    setNoteEditText("");
  };

  const cancelNoteDay = () => {
    setNoteEditingDay(null);
    setNoteEditText("");
  };

  const saveNoteToDay = (dayNum: number) => {
    const note = noteEditText.trim();
    if (!note) return;
    const updated = appendNoteToDay(data.markdown, dayNum, note);
    if (!updated || updated === data.markdown) return;
    persistItinerary({ ...data, markdown: updated, generatedAt: new Date().toISOString() });
    setCopyMessage(`Day ${dayNum}에 메모를 추가했습니다.`);
    setTimeout(() => setCopyMessage(null), 2000);
    cancelNoteDay();
  };

  const startEditDay = (dayNum: number, raw: string) => {
    setEditingDay(dayNum);
    setEditText(stripDayHeader(raw));
  };

  const cancelEditDay = () => {
    setEditingDay(null);
    setEditText("");
  };

  const saveEditDay = (dayNum: number, title: string) => {
    const body = stripDayHeader(editText).trim();
    if (!body) return;
    const newBlock = `## Day ${dayNum} - ${title}\n${body}\n`;
    const updated = replaceDayByRaw(data.markdown, dayNum, newBlock);
    if (!updated || updated === data.markdown) return;
    persistItinerary({ ...data, markdown: updated, generatedAt: new Date().toISOString() });
    setCopyMessage(`Day ${dayNum}를 수정했습니다.`);
    setTimeout(() => setCopyMessage(null), 2000);
    cancelEditDay();
  };

  const addDay = () => {
    const maxDay = rawDaySections.reduce((max, d) => Math.max(max, d.dayNum), 0);
    const nextDay = maxDay + 1;
    const newBlock = [
      `## Day ${nextDay} - 새 일정`,
      "### 오전",
      "- 장소를 입력하세요",
      "### 점심",
      "- 장소를 입력하세요",
      "### 오후",
      "- 장소를 입력하세요",
      "### 저녁",
      "- 장소를 입력하세요",
    ].join("\n");
    const updated = `${data.markdown.trimEnd()}\n\n${newBlock}\n`;
    const nextNights = getNightsFromMarkdown(updated);
    persistItinerary({
      ...data,
      payload: { ...data.payload, nights: nextNights },
      markdown: updated,
      generatedAt: new Date().toISOString(),
    });
    setCopyMessage(`Day ${nextDay}를 추가했습니다.`);
    setTimeout(() => setCopyMessage(null), 2000);
  };

  const removeDay = (dayNum: number) => {
    const confirmed = window.confirm(`Day ${dayNum} 일정을 삭제할까요?`);
    if (!confirmed) return;
    const updated = clearDayInMarkdown(data.markdown, dayNum);
    if (!updated || updated === data.markdown) return;
    const nextNights = getNightsFromMarkdown(updated);
    persistItinerary({
      ...data,
      payload: { ...data.payload, nights: nextNights },
      markdown: updated,
      generatedAt: new Date().toISOString(),
    });
    setCopyMessage(`Day ${dayNum} 일정을 비웠습니다.`);
    setTimeout(() => setCopyMessage(null), 2000);
  };

  const downloadPdf = () => {
    const prevTitle = document.title;
    document.title = `${city}-${country}-itinerary`;
    window.print();
    // Some browsers restore after print asynchronously.
    setTimeout(() => {
      document.title = prevTitle;
    }, 300);
  };

  const loadMapPoints = async (force = false) => {
    if (mapLoading) return;
    if (!force && mapPoints.length) return;
    const items = extractPlaceCandidatesWithMeta(data.markdown);
    const requestItems =
      items.length > 0 ? items : [{ name: city || country || "Trip", dayNum: 1, order: 1 }];
    if (!items.length) {
      setMapError("일정에서 장소를 추출하지 못했습니다. 도시 중심으로 표시합니다.");
    }
    setMapLoading(true);
    setMapError(null);
    try {
      const res = await fetch("/api/geo/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city,
          country,
          items: requestItems,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMapError(json.error || "지도 데이터를 불러오지 못했습니다.");
        return;
      }
      setMapProvider(typeof json.provider === "string" ? json.provider : null);
      const points: MapPoint[] = (json.results || [])
        .filter((r: any) => r.found && Number.isFinite(r.lat) && Number.isFinite(r.lon))
        .map((r: any) => ({
          name: r.name || r.query,
          lat: Number(r.lat),
          lon: Number(r.lon),
          address: r.address,
          dayNum: r.dayNum ?? 1,
          order: r.order ?? 0,
          section: r.section,
        }));
      const fallbackLat = Number.isFinite(json?.fallback?.lat) ? Number(json.fallback.lat) : cityLat;
      const fallbackLon = Number.isFinite(json?.fallback?.lon) ? Number(json.fallback.lon) : cityLon;
      const fallbackAddress = json?.fallback?.address;
      if (!points.length && Number.isFinite(fallbackLat) && Number.isFinite(fallbackLon)) {
        const centerLat = Number(fallbackLat);
        const centerLon = Number(fallbackLon);
        if (items.length > 0) {
          const approx = items.map((item, idx) => {
            const angle = (idx / Math.max(1, items.length)) * Math.PI * 2;
            const radius = 0.004 + (idx % 5) * 0.0015;
            return {
              name: item.name,
              lat: centerLat + Math.cos(angle) * radius,
              lon: centerLon + Math.sin(angle) * radius,
              address: fallbackAddress,
              dayNum: item.dayNum ?? 1,
              order: item.order ?? idx + 1,
              section: item.section,
            };
          });
          points.push(...approx);
          setMapError("일부 장소 좌표를 찾지 못해 도시 중심 근처로 추정 표시했습니다.");
        } else {
          points.push({
            name: json?.fallback?.query || `${city}, ${country}`,
            lat: centerLat,
            lon: centerLon,
            address: fallbackAddress,
          });
          setMapError("장소 좌표를 찾지 못해 도시 중심으로 표시했습니다.");
        }
      }
      if (!points.length) {
        setMapError("좌표를 찾은 장소가 없습니다. 도시 중심 표시도 실패했습니다.");
        return;
      }
      setMapPoints(points);
    } catch {
      setMapError("지도 데이터를 불러오지 못했습니다.");
    } finally {
      setMapLoading(false);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const Kakao = (window as any)?.Kakao;
      if (Kakao && Kakao.isInitialized()) {
        setKakaoReady(true);
        clearInterval(interval);
      }
    }, 300);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (mapPoints.length > 0) {
      loadMapPoints(true);
    } else {
      setMapProvider(null);
      setMapDay(null);
      setMapError(null);
    }
  }, [data.markdown]);

  return (
    <div className="itinerary-print-root mx-auto max-w-3xl">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {city}, {country}
          </h1>
          <p className="mt-2 text-slate-600">
            {nights}박{travelStyles.length > 0 && ` · ${travelStyles.join(", ")}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/80 px-3 py-1 font-medium text-slate-700 shadow-sm">
              예산: {budgetMode}
            </span>
            <span className="rounded-full bg-white/80 px-3 py-1 font-medium text-slate-700 shadow-sm">
              동행: {companionType}
            </span>
            <span className="rounded-full bg-white/80 px-3 py-1 font-medium text-slate-700 shadow-sm">
              속도: {pace}
            </span>
            <span className="rounded-full bg-white/80 px-3 py-1 font-medium text-slate-700 shadow-sm">
              시간: {String(dayStartHour).padStart(2, "0")}:00~{String(dayEndHour).padStart(2, "0")}:00
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            예산 추정(1인): {formatManwon(budgetEstimate.perDay.min)}~{formatManwon(budgetEstimate.perDay.max)}/일 · 총{" "}
            {formatManwon(budgetEstimate.total.min)}~{formatManwon(budgetEstimate.total.max)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
            <span className="rounded-full bg-white/80 px-2.5 py-1 shadow-sm">
              숙박 {formatManwon(budgetEstimate.categories.lodging.min)}~{formatManwon(budgetEstimate.categories.lodging.max)}
            </span>
            <span className="rounded-full bg-white/80 px-2.5 py-1 shadow-sm">
              식비 {formatManwon(budgetEstimate.categories.food.min)}~{formatManwon(budgetEstimate.categories.food.max)}
            </span>
            <span className="rounded-full bg-white/80 px-2.5 py-1 shadow-sm">
              교통 {formatManwon(budgetEstimate.categories.transport.min)}~{formatManwon(budgetEstimate.categories.transport.max)}
            </span>
            <span className="rounded-full bg-white/80 px-2.5 py-1 shadow-sm">
              활동 {formatManwon(budgetEstimate.categories.activities.min)}~{formatManwon(budgetEstimate.categories.activities.max)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            지역/시즌/환율에 따라 달라질 수 있습니다.
          </p>
        </div>
        <div data-print="hide" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadPdf}
            className="rounded-xl bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-lg transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          >
            PDF 다운로드
          </button>
          <button
            type="button"
            onClick={createShareLink}
            disabled={shareLoading}
            className="rounded-xl bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-lg transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:opacity-60"
          >
            {shareLoading ? "링크 생성 중..." : "공유 링크 만들기"}
          </button>
          <button
            type="button"
            onClick={shareKakao}
            disabled={!kakaoReady}
            title={kakaoReady ? "카카오톡 공유" : "카카오 도메인 등록 후 활성화됩니다."}
            className="rounded-xl bg-[#FEE500] px-4 py-2.5 text-sm font-semibold text-[#3A1D1D] shadow-lg transition disabled:opacity-60"
          >
            카카오톡 공유
          </button>
          <Link
            href="/"
            className="rounded-xl bg-white/90 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-lg transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          >
            다른 일정 만들기
          </Link>
        </div>
      </div>

      {copyMessage && (
        <div data-print="hide" className="mb-4 rounded-xl bg-slate-900/90 px-4 py-2 text-sm text-white">
          {copyMessage}
        </div>
      )}
      {(regeneratingDay !== null || regeneratingSection !== null) && (
        <div data-print="hide" className="mb-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          <div>
            {regeneratingDay !== null
              ? `Day ${regeneratingDay} 일정 재생성 중입니다...`
              : `Day ${regeneratingSection?.dayNum} ${regeneratingSection?.section} 섹션 재생성 중입니다...`}
          </div>
          <div className="progress-indeterminate mt-2 h-2 w-full rounded-full" />
        </div>
      )}

      {shareUrl && (
        <div
          data-print="hide"
          className="mb-6 rounded-2xl border border-white/20 bg-white/90 p-4 text-sm text-slate-700 shadow-lg"
        >
          <div className="font-semibold text-slate-900">공유 링크</div>
          <div className="mt-1 break-all">{shareUrl}</div>
          <button
            type="button"
            onClick={() => copyText(shareUrl, "공유 링크를 복사했습니다.")}
            className="mt-3 rounded-lg bg-violet-100 px-3 py-1.5 text-sm font-medium text-violet-700 transition hover:bg-violet-200"
          >
            링크 복사
          </button>
        </div>
      )}

      <section data-print="hide" className="mb-6 rounded-2xl border border-white/30 bg-white/80 p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">지도/동선 (Google)</h2>
          <div data-print="hide" className="flex items-center gap-2">
            <span className="text-xs text-slate-500">장소명 기준 좌표 추정</span>
            <button
              type="button"
              onClick={() => {
                void loadMapPoints();
              }}
              disabled={mapLoading || mapPoints.length > 0}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-60"
            >
              {mapPoints.length ? "지도 표시됨" : mapLoading ? "지도 불러오는 중..." : "지도 불러오기"}
            </button>
          </div>
        </div>
        {mapError && (
          <p className={`mt-2 text-xs ${mapError.includes("추정") ? "text-amber-700" : "text-rose-600"}`}>
            {mapError}
          </p>
        )}
        {mapProvider && (
          <p className="mt-1 text-[11px] text-slate-500">
            좌표 제공: {mapProvider === "google" ? "Google" : mapProvider}
          </p>
        )}
        {mapLoading && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-slate-500">지도 생성 중입니다. 잠시만 기다려 주세요.</p>
            <div className="h-80 w-full animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
          </div>
        )}
      {mapPoints.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <button
              type="button"
              onClick={() => setMapDay("all")}
              className={`rounded-full px-3 py-1 shadow-sm transition ${
                mapDay === "all" || mapDay === null
                  ? "bg-slate-900 text-white"
                  : "bg-white/80 text-slate-700 hover:bg-slate-100"
              }`}
            >
              전체
            </button>
            {mapDays.map((day) => (
              <button
                key={`map-day-${day}`}
                type="button"
                onClick={() => setMapDay(day)}
                className={`rounded-full px-3 py-1 shadow-sm transition ${
                  mapDay === day
                    ? "bg-slate-900 text-white"
                    : "bg-white/80 text-slate-700 hover:bg-slate-100"
                }`}
              >
                Day {day}
              </button>
            ))}
          </div>
          <ItineraryMap points={mapPoints} selectedDay={mapDay ?? "all"} />
          <p className="text-xs text-slate-500">
            D1-1, D1-2 표시는 Day/순서를 의미합니다. 지도는 장소명을 기반으로 추정한 결과입니다.
          </p>
        </div>
      )}
      </section>

      <section className="mb-6 rounded-2xl border border-white/30 bg-white/80 p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">현실성 체크 (베타)</h2>
          <div data-print="hide" className="flex items-center gap-2">
            <span className="text-xs text-slate-500">운영시간 실검증은 별도 장소 상세 API 필요</span>
          </div>
        </div>
        {feasibility.byDay.length > 0 ? (
          <div className="mt-3 space-y-2">
            {feasibility.byDay.map((d) => (
              <div
                key={`check-${d.dayNum}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
              >
                <div className="text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Day {d.dayNum}</span>
                  <span className="ml-2">장소 {d.itemCount}개 · 이동 {d.moveMinutes}분</span>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    d.warnings.length
                      ? "bg-amber-100 text-amber-800"
                      : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {d.warnings.length ? `주의 ${d.warnings.length}` : "양호"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">Day 섹션을 파싱할 수 없어 상세 체크를 건너뛰었습니다.</p>
        )}
        {feasibility.warnings.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {feasibility.warnings.slice(0, 6).map((w, idx) => (
              <li key={`warn-${idx}`}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      {(regeneratingDay !== null || regeneratingSection !== null) ? (
        <div className="space-y-4">
          <DaySkeleton />
          <DaySkeleton />
        </div>
      ) : daySections.length > 0 ? (
        <div className="space-y-8">
          <div data-print="hide" className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={addDay}
              className="rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-200"
            >
              Day 추가
            </button>
          </div>
          {daySections.map(({ dayNum, title, raw, displayRaw }) => (
            <article
              key={dayNum}
              data-print="day-card"
              className="rounded-3xl border border-white/20 bg-white/90 p-6 shadow-xl backdrop-blur sm:p-8"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-slate-900">Day {dayNum} · {title}</h2>
                <div data-print="hide" className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startEditDay(dayNum, raw)}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    편집
                  </button>
                  <button
                    type="button"
                    onClick={() => addNoteToDay(dayNum)}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    메모 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => replaceDay(dayNum)}
                    disabled={regeneratingDay === dayNum}
                    className="rounded-lg bg-violet-100 px-3 py-1.5 text-sm font-medium text-violet-700 transition hover:bg-violet-200 disabled:opacity-50"
                  >
                    {regeneratingDay === dayNum ? "생성 중..." : "이 날 다시 만들기"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDay(dayNum)}
                    className="rounded-lg bg-rose-100 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-200"
                  >
                    이 날 삭제
                  </button>
                </div>
              </div>
              {editingDay === dayNum ? (
                <div className="mb-4 space-y-3">
                  <p className="text-xs text-slate-500">
                    제목은 고정입니다. 본문만 수정하세요.
                  </p>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={12}
                    className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => saveEditDay(dayNum, title)}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditDay}
                      className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : noteEditingDay === dayNum ? (
                <div className="mb-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-500">Day {dayNum} 메모를 입력하세요.</p>
                  <textarea
                    value={noteEditText}
                    onChange={(e) => setNoteEditText(e.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                    placeholder="예: 저녁 예약 필요 / 우천 시 실내 대체 코스"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => saveNoteToDay(dayNum)}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
                    >
                      메모 저장
                    </button>
                    <button
                      type="button"
                      onClick={cancelNoteDay}
                      className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div data-print="hide" className="mb-4 flex flex-wrap gap-2">
                  {getAllowedSectionTitles(displayRaw).map((sectionTitle) => (
                    <button
                      key={`${dayNum}-${sectionTitle}`}
                      type="button"
                      onClick={() => replaceSection(dayNum, sectionTitle)}
                      disabled={
                        regeneratingSection?.dayNum === dayNum &&
                        regeneratingSection?.section === sectionTitle
                      }
                      className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 transition hover:bg-amber-200 disabled:opacity-60"
                    >
                      {regeneratingSection?.dayNum === dayNum &&
                      regeneratingSection?.section === sectionTitle
                        ? `${sectionTitle} 생성 중...`
                        : `${sectionTitle} 다시 만들기`}
                    </button>
                  ))}
                </div>
              )}
              <MarkdownBlock>{renderMarkdown(displayRaw)}</MarkdownBlock>
            </article>
          ))}
        </div>
      ) : (
        <article data-print="day-card" className="rounded-3xl border border-white/20 bg-white/90 p-6 shadow-xl backdrop-blur sm:p-8">
          <MarkdownBlock>{renderMarkdown(data.markdown)}</MarkdownBlock>
        </article>
      )}
    </div>
  );
}
