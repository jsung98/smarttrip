"use client";

import {
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo, useState, useCallback, Fragment, useEffect, useRef, type CSSProperties } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import ItineraryMap, { type MapPoint } from "@/components/ItineraryMap";
import TripEditor from "@/components/itinerary/TripEditor";
import { getTripDayId, getTripSectionId, toTripDocument } from "@/lib/domain/trip-adapters";
import { tripReducer } from "@/lib/domain/trip-reducer";
import { analyzeStructuredDay } from "@/lib/feasibility";
import { saveAndActivateItinerary } from "@/lib/localItineraryStore";
import { getTripStorageGateway } from "@/lib/tripStorage";
import { setCurrentTrip } from "@/lib/tripSessionStore";
import { normalizeTripPayload, type StoredItinerary } from "@/lib/types";
import type { TripDocument } from "@/lib/domain/trip-document";
import type { Activity, DayPlan } from "@/types/itinerary";
import type { FinalDay, FinalItinerary, FinalPlace, SectionKey, StructuredDay, StructuredPlan } from "@/types/plan";

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

const DAY_HEADER_PATTERN = "^## Day (\\d+)(?:\\s*(?:-|\\u2013|\\u2014|\\u00B7)\\s*(.*))?$";
const DAY_HEADER_LINE_RE = /^## Day (\d+)(?:\s*(?:-|[\u2013\u2014\u00B7])\s*(.*))?$/;
const DAY_HEADER_STRIP_RE = /^## Day \d+(?:\s*(?:-|[\u2013\u2014\u00B7])\s*[^\n]*)?\n?/;

function normalizeDayHeaderLine(line: string | undefined, fallbackDayNum: number, fallbackTitle = "일정"): string {
  const trimmed = (line || "").trim();
  const m = DAY_HEADER_LINE_RE.exec(trimmed);
  if (!m) return `## Day ${fallbackDayNum} - ${fallbackTitle}`;
  const day = Number.parseInt(m[1], 10);
  const title = (m[2] || "").trim() || fallbackTitle;
  return `## Day ${Number.isFinite(day) ? day : fallbackDayNum} - ${title}`;
}

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
    last = { dayNum: parseInt(m[1], 10), title: (m[2] || "").trim() || "일정", start: m.index };
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
  const oldTitle = extractDaySections(range.raw)[0]?.title || "일정";
  const header = normalizeDayHeaderLine(range.raw.split("\n")[0], dayNum, oldTitle);
  const newBody = newBlock.replace(DAY_HEADER_STRIP_RE, "").trim();
  const replacement = `${header}\n${newBody}`.trimEnd();
  return `${markdown.slice(0, range.start)}${replacement}\n\n${markdown.slice(range.end)}`
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function stripDayHeader(block: string): string {
  return block.replace(DAY_HEADER_STRIP_RE, "").trim();
}

function replaceDayByRaw(markdown: string, dayNum: number, newBlock: string): string {
  const range = findDayRange(markdown, dayNum);
  if (!range) return markdown;
  const normalized = newBlock.trimEnd();
  return `${markdown.slice(0, range.start)}${normalized}\n\n${markdown.slice(range.end)}`
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function extractRequestedDayBlock(rawBlock: string, dayNum: number): string {
  const normalized = normalizeDayRaw(rawBlock).trim();
  if (!normalized) return `## Day ${dayNum} - 일정\n${EMPTY_DAY_TEMPLATE}`;

  const parsedDays = extractDaySections(normalized);
  if (parsedDays.length > 0) {
    const exact = parsedDays.find((d) => d.dayNum === dayNum) ?? parsedDays[0];
    return sanitizeDayRaw(exact.raw, dayNum);
  }

  const body = stripDayHeader(normalized);
  return sanitizeDayRaw(`## Day ${dayNum} - 일정\n${body}`, dayNum);
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
  const headerLine = normalizeDayHeaderLine(lines[0], dayNum, "일정");

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

function analyzeLegacyDay(raw: string) {
  let stayMinutes = 0;
  let moveMinutes = 0;
  const stayRegex = /체류\s*(\d+)\s*분/g;
  const moveRegex = /이동\s*(\d+)\s*분/g;

  let stayMatch: RegExpExecArray | null;
  while ((stayMatch = stayRegex.exec(raw)) !== null) {
    stayMinutes += Number(stayMatch[1] || 0);
  }

  let moveMatch: RegExpExecArray | null;
  while ((moveMatch = moveRegex.exec(raw)) !== null) {
    moveMinutes += Number(moveMatch[1] || 0);
  }

  const itemCount = (raw.match(/^- /gm) || []).length;
  const sectionCount = (raw.match(/^### /gm) || []).length;
  const missingMoveHints = itemCount - (raw.match(/이동\s*\d+\s*분/g) || []).length;

  const estimatedStay = stayMinutes > 0 ? stayMinutes : itemCount * 60;
  const totalMinutes = estimatedStay + moveMinutes;
  const moveRatio = totalMinutes > 0 ? moveMinutes / totalMinutes : 0;

  const warnings: string[] = [];
  if (itemCount >= 12) warnings.push("방문 장소가 많아 일정이 빡빡할 수 있어요.");
  if (moveMinutes >= 210) warnings.push("하루 총 이동 시간이 길어요.");
  if (sectionCount >= 6 && itemCount >= 10) warnings.push("섹션 수 대비 활동량이 많아요.");
  if (missingMoveHints >= 3) warnings.push("이동시간 표기가 부족해 현실성 판단이 어려워요.");

  return {
    totalStay: estimatedStay,
    totalMove: moveMinutes,
    totalMinutes,
    moveRatio,
    activityCount: itemCount,
    warnings,
  };
}

function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hour = Math.floor(safe / 60);
  const min = safe % 60;
  if (hour === 0) return `${min}분`;
  if (min === 0) return `${hour}시간`;
  return `${hour}시간 ${min}분`;
}

function getStatus(warnings: string[], totalMinutes: number, moveRatio: number) {
  if (totalMinutes > 840 || moveRatio > 0.6) {
    return { label: "🔴 하루 일정이 과도합니다", tone: "bg-rose-100 text-rose-700" };
  }
  if (warnings.length > 0) {
    return { label: "🟡 이동 비율이 다소 높습니다", tone: "bg-amber-100 text-amber-800" };
  }
  return { label: "🟢 일정 균형 양호", tone: "bg-emerald-100 text-emerald-700" };
}

function activityIcon(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes("food") || normalized.includes("meal") || normalized.includes("restaurant")) return "🍽";
  if (normalized.includes("cafe")) return "☕";
  if (normalized.includes("shopping")) return "🛍";
  if (normalized.includes("night")) return "🌙";
  return "🏛";
}

function isFoodType(type: string): boolean {
  const normalized = type.toLowerCase();
  return (
    normalized.includes("food") ||
    normalized.includes("meal") ||
    normalized.includes("restaurant") ||
    normalized.includes("식당") ||
    normalized.includes("맛집")
  );
}

function groupActivitiesForUI(activities: Activity[]) {
  const schedule: Record<"아침 일정" | "점심 일정" | "저녁 일정", Activity[]> = {
    "아침 일정": [],
    "점심 일정": [],
    "저녁 일정": [],
  };
  const mealRecs: Record<"점심 식사 장소 추천" | "저녁 식사 장소 추천", Activity[]> = {
    "점심 식사 장소 추천": [],
    "저녁 식사 장소 추천": [],
  };

  const meals = activities.filter((a) => isFoodType(a.type));
  const nonMeals = activities.filter((a) => !isFoodType(a.type));

  if (meals[0]) mealRecs["점심 식사 장소 추천"].push(meals[0]);
  if (meals[1]) mealRecs["저녁 식사 장소 추천"].push(meals[1]);
  for (let i = 2; i < meals.length; i++) {
    mealRecs[i % 2 === 0 ? "점심 식사 장소 추천" : "저녁 식사 장소 추천"].push(meals[i]);
  }

  const order: Array<"아침 일정" | "점심 일정" | "저녁 일정"> = ["아침 일정", "점심 일정", "저녁 일정"];
  nonMeals.forEach((activity, idx) => {
    schedule[order[idx % order.length]].push(activity);
  });

  return { schedule, mealRecs };
}

function getActivityDescription(activity: Activity): string {
  return activity.description?.trim() || "";
}

type UiSection = "오전" | "점심" | "오후" | "저녁" | "밤";

function inferActivityType(section: UiSection, name: string, explicitType?: string): Activity["type"] {
  if (explicitType && explicitType.trim()) {
    const lowerExplicitType = explicitType.trim().toLowerCase();
    if (lowerExplicitType.includes("cafe") || lowerExplicitType.includes("카페")) return "cafe";
    if (
      lowerExplicitType.includes("food") ||
      lowerExplicitType.includes("meal") ||
      lowerExplicitType.includes("restaurant") ||
      lowerExplicitType.includes("식당") ||
      lowerExplicitType.includes("맛집")
    ) {
      return "food";
    }
    return "attraction";
  }
  const lowerName = name.toLowerCase();
  if (section === "점심" || section === "저녁") return "food";
  if (lowerName.includes("카페") || lowerName.includes("cafe")) return "cafe";
  return "attraction";
}

function parseActivitiesFromMarkdownDay(raw: string): Record<UiSection, Activity[]> {
  const buckets: Record<UiSection, Activity[]> = {
    오전: [],
    점심: [],
    오후: [],
    저녁: [],
    밤: [],
  };
  const sections = extractDaySubsections(raw);
  for (const section of sections) {
    if (!ALLOWED_SECTIONS.includes(section.title as UiSection)) continue;
    const sectionTitle = section.title as UiSection;
    const body = section.raw.replace(/^###\s+.+?\n?/, "").trim();
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("- ")) continue;
      if (trimmed.includes("장소를 입력하세요")) continue;
      const content = trimmed.slice(2).trim();
      if (!content) continue;

      const stayMatch = /체류\s*(\d+)\s*분/.exec(content);
      const moveMatch = /이동\s*(\d+)\s*분/.exec(content);
      const ratingMatch = /평점\s*(\d+(?:\.\d+)?)/.exec(content);
      const boldNameMatch = /\*\*([^*]+)\*\*/.exec(content);
      const typeMatch = /\(([^)]+)\)/.exec(content);
      const descMatch = /\)\s*([^·\[]+?)\s*(?:체류|이동|$)/.exec(content);
      const plainName = content
        .replace(/\*\*([^*]+)\*\*/, "$1")
        .replace(/\[[^\]]+\]\([^)]+\)/g, "")
        .replace(/체류\s*\d+\s*분/g, "")
        .replace(/이동\s*\d+\s*분/g, "")
        .replace(/\([^)]+\)/g, "")
        .split(/[·|-]/)[0]
        .trim();

      const name = boldNameMatch?.[1]?.trim() || plainName;
      if (!name) continue;
      const type = inferActivityType(sectionTitle, name, typeMatch?.[1]);
      const stayMinutes = Number(stayMatch?.[1] || 60);
      const moveMinutesToNext = Number(moveMatch?.[1] || 0);
      const rating = Number(ratingMatch?.[1] || 4.2);
      const description = descMatch?.[1]?.trim() || null;

      buckets[sectionTitle].push({
        name,
        type,
        description,
        stayMinutes,
        moveMinutesToNext,
        rating,
        mapUrl: "",
        directionsUrl: "",
      });
    }
  }
  return buckets;
}

function toDayPlansFromStructuredPlanDays(days: StructuredDay[]): DayPlan[] {
  return days
    .slice()
    .sort((a, b) => a.day - b.day)
    .map((day) => ({
      day: day.day,
      theme: "일정",
      summary: null,
      activities: day.sections.map((section) => ({
        name: section.title,
        type: section.key === "lunch" || section.key === "dinner" ? "food" : "attraction",
        description: section.intent || "",
        stayMinutes: section.durationMinutes ?? 60,
        moveMinutesToNext: 20,
        rating: 0,
        lat: 0,
        lng: 0,
        mapUrl: "",
        directionsUrl: "",
      })),
    }));
}

const HYBRID_SECTION_KEYS: SectionKey[] = ["morning", "lunch", "afternoon", "dinner", "night"];
const HYBRID_SECTION_TITLES: Record<SectionKey, string> = {
  morning: "오전",
  lunch: "점심",
  afternoon: "오후",
  dinner: "저녁",
  night: "밤",
};
const SECTION_TITLE_TO_KEY: Record<string, SectionKey> = Object.entries(HYBRID_SECTION_TITLES).reduce(
  (acc, [key, title]) => {
    acc[title] = key as SectionKey;
    return acc;
  },
  {} as Record<string, SectionKey>
);

type SectionStatus = "ready" | "loading" | "empty" | "error" | "regenerating";

type SectionViewModel = {
  sectionKey: SectionKey;
  title: string;
  places: Array<FinalPlace & { id?: string }>;
  intent: string;
  durationMinutes: number;
  type: "tour" | "meal";
  status: SectionStatus;
};

function buildSectionViewModel(
  sectionKey: SectionKey,
  finalDay?: FinalDay,
  structuredDay?: StructuredDay,
  runtimeStatus?: SectionStatus
): SectionViewModel {
  const finalSection = finalDay?.sections.find((section) => section.key === sectionKey);
  const structuredSection = structuredDay?.sections.find((section) => section.key === sectionKey);
  const type: SectionViewModel["type"] = sectionKey === "lunch" || sectionKey === "dinner" ? "meal" : "tour";
  const sourcePlaces = finalSection?.places ?? [];
  const places = type === "meal" ? sourcePlaces.slice(0, 3) : sourcePlaces.slice(0, 1);
  const computedStatus: SectionStatus = places.length > 0 ? "ready" : "empty";
  
  return {
    sectionKey,
    title: finalSection?.title || structuredSection?.title || HYBRID_SECTION_TITLES[sectionKey],
    places,
    intent: finalSection?.intent || structuredSection?.intent || "",
    durationMinutes: finalSection?.durationMinutes ?? structuredSection?.durationMinutes ?? 60,
    type,
    status: runtimeStatus ?? computedStatus,
  };
}

function buildSectionViewModelFromTripDay(
  day: ReturnType<typeof toTripDocument>["days"][number],
  sectionKey: SectionKey,
  runtimeStatus?: SectionStatus
): SectionViewModel {
  const section = day.sections.find((item) => item.key === sectionKey);
  const type: SectionViewModel["type"] = sectionKey === "lunch" || sectionKey === "dinner" ? "meal" : "tour";
  const sourcePlaces = section?.places ?? [];
  const places = type === "meal" ? sourcePlaces.slice(0, 3) : sourcePlaces.slice(0, 1);
  const computedStatus: SectionStatus = places.length > 0 ? "ready" : "empty";

  return {
    sectionKey,
    title: section?.title || HYBRID_SECTION_TITLES[sectionKey],
    places,
    intent: section?.intent || "",
    durationMinutes: section?.durationMinutes ?? 60,
    type,
    status: runtimeStatus ?? computedStatus,
  };
}

function getSectionStateKey(dayNum: number, sectionKey: SectionKey): string {
  return `${dayNum}|${sectionKey}`;
}

function patchStructuredSectionIntent(
  plan: StructuredPlan | undefined,
  dayNum: number,
  sectionKey: SectionKey,
  intent: string
): StructuredPlan | undefined {
  if (!plan?.days?.length) return plan;
  return {
    ...plan,
    days: plan.days.map((day) => {
      if (day.day !== dayNum) return day;
      return {
        ...day,
        sections: day.sections.map((section) =>
          section.key === sectionKey ? { ...section, intent } : section
        ),
      };
    }),
  };
}

function summarizeSectionBodyAsIntent(body: string): string {
  const summary = body
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean)
    .join(" / ")
    .trim();
  return summary;
}

function patchStructuredDayFromMarkdown(
  plan: StructuredPlan | undefined,
  dayNum: number,
  rawDayBlock: string
): StructuredPlan | undefined {
  if (!plan?.days?.length) return plan;

  const nextIntents = new Map<SectionKey, string>();
  for (const section of extractDaySubsections(sanitizeDayRaw(rawDayBlock, dayNum))) {
    const sectionKey = SECTION_TITLE_TO_KEY[section.title];
    if (!sectionKey) continue;
    const body = cleanSectionBody(section.raw.replace(/^###\s+.+?\n?/, "").trim(), section.title);
    const summary = summarizeSectionBodyAsIntent(body);
    if (summary) nextIntents.set(sectionKey, summary);
  }

  return {
    ...plan,
    days: plan.days.map((day) => {
      if (day.day !== dayNum) return day;
      return {
        ...day,
        sections: day.sections.map((section) => {
          const nextIntent = nextIntents.get(section.key);
          return nextIntent ? { ...section, intent: nextIntent } : section;
        }),
      };
    }),
  };
}

function removeDayFromStructuredPlan(plan: StructuredPlan | undefined, dayNum: number): StructuredPlan | undefined {
  if (!plan?.days?.length) return plan;
  const remaining = plan.days.filter((day) => day.day !== dayNum);
  return {
    ...plan,
    days: remaining.map((day, idx) => ({
      ...day,
      day: idx + 1,
    })),
  };
}

function removeDayFromFinalItinerary(
  itinerary: FinalItinerary | undefined,
  dayNum: number
): FinalItinerary | undefined {
  if (!itinerary?.days?.length) return itinerary;
  const remaining = itinerary.days.filter((day) => day.day !== dayNum);
  return {
    ...itinerary,
    days: remaining.map((day, idx) => ({
      ...day,
      day: idx + 1,
    })),
  };
}

function removeDayMemoMap(
  dayMemos: Record<string, string> | undefined,
  dayNum: number
): Record<string, string> | undefined {
  if (!dayMemos) return dayMemos;
  const nextEntries = Object.entries(dayMemos)
    .filter(([key]) => Number(key) !== dayNum)
    .map(([key, value]) => {
      const numericKey = Number(key);
      if (Number.isInteger(numericKey) && numericKey > dayNum) {
        return [String(numericKey - 1), value] as const;
      }
      return [key, value] as const;
    });
  return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
}

function reorderArray<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return items.slice();
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return items.slice();
  next.splice(toIndex, 0, moved);
  return next;
}

function reorderStructuredPlanDays(
  plan: StructuredPlan | undefined,
  fromIndex: number,
  toIndex: number
): StructuredPlan | undefined {
  if (!plan?.days?.length) return plan;
  const reordered = reorderArray(plan.days, fromIndex, toIndex);
  return {
    ...plan,
    days: reordered.map((day, idx) => ({
      ...day,
      day: idx + 1,
    })),
  };
}

function reorderFinalItineraryDays(
  itinerary: FinalItinerary | undefined,
  fromIndex: number,
  toIndex: number
): FinalItinerary | undefined {
  if (!itinerary?.days?.length) return itinerary;
  const reordered = reorderArray(itinerary.days, fromIndex, toIndex);
  return {
    ...itinerary,
    days: reordered.map((day, idx) => ({
      ...day,
      day: idx + 1,
    })),
  };
}

function reorderDayMemoMap(
  dayMemos: Record<string, string> | undefined,
  fromIndex: number,
  toIndex: number,
  dayCount: number
): Record<string, string> | undefined {
  if (!dayMemos) return dayMemos;
  const ordered = Array.from({ length: dayCount }, (_, idx) => dayMemos[String(idx + 1)] ?? "");
  const reordered = reorderArray(ordered, fromIndex, toIndex);
  const nextEntries = reordered
    .map((value, idx) => [String(idx + 1), value.trim()] as const)
    .filter(([, value]) => value.length > 0);
  return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
}

function appendDayToStructuredPlan(plan: StructuredPlan | undefined, dayNum: number): StructuredPlan | undefined {
  if (!plan?.days) return plan;
  return {
    ...plan,
    days: [
      ...plan.days,
      {
        day: dayNum,
        sections: HYBRID_SECTION_KEYS.map((sectionKey) => ({
          key: sectionKey,
          title: HYBRID_SECTION_TITLES[sectionKey],
          intent: "",
          durationMinutes: sectionKey === "lunch" || sectionKey === "dinner" ? 90 : 120,
          foodRequired: sectionKey === "lunch" || sectionKey === "dinner",
        })),
      },
    ],
  };
}

function appendDayToFinalItinerary(
  itinerary: FinalItinerary | undefined,
  structuredPlan: StructuredPlan | undefined,
  dayNum: number
): FinalItinerary | undefined {
  if (!structuredPlan?.days) return itinerary;
  const baseSections =
    structuredPlan.days.find((day) => day.day === dayNum)?.sections ??
    HYBRID_SECTION_KEYS.map((sectionKey) => ({
      key: sectionKey,
      title: HYBRID_SECTION_TITLES[sectionKey],
      intent: "",
      areaHint: undefined,
      durationMinutes: sectionKey === "lunch" || sectionKey === "dinner" ? 90 : 120,
      foodRequired: sectionKey === "lunch" || sectionKey === "dinner",
    }));

  const nextDay: FinalDay = {
    day: dayNum,
    sections: baseSections.map((section) => ({
      key: section.key,
      title: section.title,
      intent: section.intent,
      areaHint: section.areaHint,
      durationMinutes: section.durationMinutes,
      foodRequired: section.foodRequired,
      places: [],
    })),
  };

  if (!itinerary?.days) {
    return { days: [nextDay] };
  }

  return {
    ...itinerary,
    days: [...itinerary.days, nextDay],
  };
}

function mergeSectionPlaces(
  prevFinalItinerary: FinalItinerary | undefined,
  nextFinalItinerary: FinalItinerary | undefined,
  dayNum: number,
  sectionKey: SectionKey
): FinalItinerary | undefined {
  if (!nextFinalItinerary || !Array.isArray(nextFinalItinerary.days)) {
    return prevFinalItinerary;
  }

  if (!prevFinalItinerary) {
    return nextFinalItinerary;
  }

  const nextTargetDay = nextFinalItinerary.days.find((day) => day.day === dayNum);
  if (!nextTargetDay) {
    return prevFinalItinerary;
  }

  const nextTargetSection = nextTargetDay.sections.find((section) => section.key === sectionKey);
  if (!nextTargetSection) {
    return prevFinalItinerary;
  }

  return {
    ...prevFinalItinerary,
    days: prevFinalItinerary.days.map((day) => {
      if (day.day !== dayNum) return day;

      return {
        ...day,
        sections: day.sections.map((section) => {
          if (section.key !== sectionKey) return section;

          return {
            ...section,
            places: Array.isArray(nextTargetSection.places) ? nextTargetSection.places : section.places,
          };
        }),
      };
    }),
  };
}

async function fetchTargetSectionPlaces(params: {
  structuredPlan: StructuredPlan;
  city: string;
  country: string;
  dayNum: number;
  sectionKey: SectionKey;
}): Promise<FinalItinerary | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch("/api/places/fill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredPlan: params.structuredPlan,
        city: params.city,
        country: params.country,
        target: {
          day: params.dayNum,
          sectionKey: params.sectionKey,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) return undefined;

    const json = (await res.json()) as { finalItinerary?: FinalItinerary };
    if (!json.finalItinerary || !Array.isArray(json.finalItinerary.days)) {
      return undefined;
    }

    return json.finalItinerary;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return undefined;
    }
    return undefined;
  } finally {
    clearTimeout(timer);
  }
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

function normalizeStoredForView(input: StoredItinerary): StoredItinerary {
  return {
    ...input,
    payload: normalizeTripPayload(input.payload),
  };
}

function applyReplaceSectionPatch(
  current: TripDocument,
  nextStored: StoredItinerary,
  dayNum: number,
  sectionKey: SectionKey
): TripDocument {
  const candidate = toTripDocument(nextStored);
  const nextDay = candidate.days.find((day) => day.dayNumber === dayNum);
  const nextSection = nextDay?.sections.find((section) => section.key === sectionKey);
  if (!nextDay || !nextSection) {
    return candidate;
  }

  return tripReducer(current, {
    type: "replaceSection",
    baseRevision: current.revision,
    dayId: getTripDayId(dayNum),
    sectionId: getTripSectionId(dayNum, sectionKey),
    section: nextSection,
  });
}

function applyReplaceDayPatch(current: TripDocument, nextStored: StoredItinerary, dayNum: number): TripDocument {
  const candidate = toTripDocument(nextStored);
  const nextDay = candidate.days.find((day) => day.dayNumber === dayNum);
  if (!nextDay) {
    return candidate;
  }

  return tripReducer(current, {
    type: "replaceDay",
    baseRevision: current.revision,
    dayId: getTripDayId(dayNum),
    day: nextDay,
  });
}

export default function ItineraryView({ data: initialData }: { data: StoredItinerary }) {
  const auth = useAuth();
  const [data, setData] = useState<StoredItinerary>(() => normalizeStoredForView(initialData));
  const [tripDocument, setTripDocument] = useState<TripDocument>(() => toTripDocument(normalizeStoredForView(initialData)));
  const [regeneratingDay, setRegeneratingDay] = useState<number | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savingTrip, setSavingTrip] = useState(false);
  const [kakaoReady, setKakaoReady] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editText, setEditText] = useState<string>("");
  const [noteEditingDay, setNoteEditingDay] = useState<number | null>(null);
  const [noteEditText, setNoteEditText] = useState<string>("");
  const [sectionStatuses, setSectionStatuses] = useState<Record<string, SectionStatus>>({});
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapPoints, setMapPoints] = useState<MapPoint[]>([]);
  const [mapDay, setMapDay] = useState<number | "all" | null>(null);
  const [mapProvider, setMapProvider] = useState<string | null>(null);
  const [focusedPlace, setFocusedPlace] = useState<{ dayNum: number; name: string; placeId?: string } | null>(null);
  const [expandedWarningDay, setExpandedWarningDay] = useState<number | null>(null);
  const [pendingReorder, setPendingReorder] = useState<{
    structuredPlan: StructuredPlan | undefined;
    finalItinerary: FinalItinerary | undefined;
    dayMemos: Record<string, string> | undefined;
  } | null>(null);
  const dataRef = useRef<StoredItinerary>(normalizeStoredForView(initialData));
  const tripDocumentRef = useRef<TripDocument>(toTripDocument(normalizeStoredForView(initialData)));
  const mapSectionRef = useRef<HTMLElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    tripDocumentRef.current = tripDocument;
  }, [tripDocument]);

  const persistItinerary = useCallback((next: StoredItinerary, nextTripDocument?: TripDocument) => {
    const normalized = normalizeStoredForView(next);
    const saved = auth.status === "authenticated" ? normalized : saveAndActivateItinerary(normalized);
    const resolvedTripDocument = nextTripDocument ?? toTripDocument(saved);
    setCurrentTrip(saved);
    dataRef.current = saved;
    tripDocumentRef.current = resolvedTripDocument;
    setData(saved);
    setTripDocument(resolvedTripDocument);
    return saved;
  }, [auth]);

  const saveTrip = useCallback(async () => {
    if (auth.status !== "authenticated") {
      if (auth.status === "guest" && typeof window !== "undefined") {
        window.location.href = auth.loginHref;
        return;
      }
      setSaveMessage("카카오 로그인 후 내 일정에 저장할 수 있어요.");
      return;
    }

    setSavingTrip(true);
    setSaveMessage(null);
    try {
      const gateway = getTripStorageGateway(auth);
      const result = await gateway.saveTrip({
        snapshot: dataRef.current,
        document: tripDocumentRef.current,
        mode: "saved",
        tripId: dataRef.current.remoteTripId,
      });

      const normalized = normalizeStoredForView({
        ...result.snapshot,
        remoteTripId: result.summary.id,
        remoteUpdatedAt: result.summary.updatedAt,
      });
      dataRef.current = normalized;
      tripDocumentRef.current = result.document;
      setData(normalized);
      setTripDocument(result.document);
      setSaveMessage("내 일정에 저장했습니다.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "일정 저장에 실패했습니다.");
    } finally {
      setSavingTrip(false);
    }
  }, [auth]);

  const replaceDay = useCallback(
  async (dayNum: number) => {
    setRegeneratingDay(dayNum);

    try {
      // 1️⃣ regenerate-day
      const regenRes = await fetch("/api/regenerate-day", {
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

      const regenJson = await regenRes.json();
      if (!regenRes.ok) {
        alert(regenJson.error || "재생성에 실패했습니다.");
        return;
      }

      const newBlock = regenJson.markdown?.trim();
      if (!newBlock) {
        alert("재생성 결과가 비어 있습니다.");
        return;
      }

      const safeDayBlock = extractRequestedDayBlock(newBlock, dayNum);

      let updatedMarkdown = replaceDayInMarkdown(
        data.markdown,
        dayNum,
        safeDayBlock
      );

      if (!updatedMarkdown || updatedMarkdown === data.markdown) {
        updatedMarkdown = replaceDayByRaw(
          data.markdown,
          dayNum,
          safeDayBlock
        );
      }

      if (!updatedMarkdown || updatedMarkdown === data.markdown) {
        alert("재생성 결과를 적용하지 못했습니다.");
        return;
      }

      // -------------------------------------------------------
      // 2️⃣ structured 재생성 체인 시작
      // -------------------------------------------------------

      try {
        // generate 호출
        const genRes = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...data.payload,
          }),
        });

        const genJson = await genRes.json();

        if (!genRes.ok || !genJson.structuredPlan) {
          // structured 실패 → fallback
          const next: StoredItinerary = {
            ...data,
            markdown: updatedMarkdown,
            itinerary: undefined,
            structuredPlan: undefined,
            finalItinerary: undefined,
            schemaVersion: undefined,
            generatedAt: new Date().toISOString(),
          };
          const normalizedNext = normalizeStoredForView(next);
          const nextTripDocument = applyReplaceDayPatch(tripDocumentRef.current, normalizedNext, dayNum);
          persistItinerary(normalizedNext, nextTripDocument);
          return;
        }

        const structuredPlan = genJson.structuredPlan;

        // places/fill 호출
        let finalItinerary = undefined;

        try {
          const fillRes = await fetch("/api/places/fill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              structuredPlan,
              city: data.payload.city,
              country: data.payload.country,
            }),
          });

          if (fillRes.ok) {
            const fillJson = await fillRes.json();
            finalItinerary = fillJson.finalItinerary;
          }
        } catch {
          console.warn("places/fill 실패 — fallback 진행");
        }

        // structured 저장
        const next: StoredItinerary = {
          ...data,
          markdown: updatedMarkdown,
          structuredPlan,
          finalItinerary,
          itinerary: finalItinerary ?? undefined,
          schemaVersion: 2,
          generatedAt: new Date().toISOString(),
        };
        const normalizedNext = normalizeStoredForView(next);
        const nextTripDocument = applyReplaceDayPatch(tripDocumentRef.current, normalizedNext, dayNum);
        persistItinerary(normalizedNext, nextTripDocument);

      } catch {
        // structured 체인 전체 실패 → markdown fallback
        const next: StoredItinerary = {
          ...data,
          markdown: updatedMarkdown,
          itinerary: undefined,
          structuredPlan: undefined,
          finalItinerary: undefined,
          schemaVersion: undefined,
          generatedAt: new Date().toISOString(),
        };
        const normalizedNext = normalizeStoredForView(next);
        const nextTripDocument = applyReplaceDayPatch(tripDocumentRef.current, normalizedNext, dayNum);
        persistItinerary(normalizedNext, nextTripDocument);
      }

    } catch {
      alert("네트워크 오류입니다.");
    } finally {
      setRegeneratingDay(null);
    }
  },
  [data, persistItinerary]
);
  const hasStructuredPlan = !!data.structuredPlan?.days?.length;
  const isHybridMode = data.schemaVersion === 2 && hasStructuredPlan;
  const legacyEnabled = data.schemaVersion !== 2;
  const rawDaySections = useMemo(() => extractDaySections(data.markdown), [data.markdown]);
  const rawDaySectionMap = useMemo(
    () => new Map(rawDaySections.map((day) => [day.dayNum, day] as const)),
    [rawDaySections]
  );
  const tripDocumentDays = useMemo(
    () => tripDocument.days.slice().sort((a, b) => a.dayNumber - b.dayNumber),
    [tripDocument]
  );
  const structuredPlanDays = useMemo(
    () => (data.structuredPlan?.days ?? []).slice().sort((a, b) => a.day - b.day),
    [data.structuredPlan?.days]
  );
  const sectionViewModelsByDay = useMemo(() => {
    const byDay = new Map<number, SectionViewModel[]>();
    if (!isHybridMode) return byDay;

    for (const day of tripDocumentDays) {
      const sectionViewModels = HYBRID_SECTION_KEYS.map((sectionKey) =>
        buildSectionViewModelFromTripDay(day, sectionKey, sectionStatuses[getSectionStateKey(day.dayNumber, sectionKey)])
      );
      byDay.set(day.dayNumber, sectionViewModels);
    }
    return byDay;
  }, [isHybridMode, tripDocumentDays, sectionStatuses]);
  const structuredDays = useMemo(
    () =>
      isHybridMode
        ? toDayPlansFromStructuredPlanDays(structuredPlanDays)
        : legacyEnabled
          ? (data.itinerary?.days ?? []).slice().sort((a, b) => a.day - b.day)
          : [],
    [isHybridMode, legacyEnabled, structuredPlanDays, data.itinerary?.days]
  );
  const daySections = useMemo(
    () => {
      if (isHybridMode) {
        return tripDocumentDays.map((day) => {
          const markdownDay = rawDaySectionMap.get(day.dayNumber);
          return {
            dayNum: day.dayNumber,
            title: day.title || markdownDay?.title || "일정",
            raw: markdownDay?.raw || "",
            displayRaw: markdownDay ? sanitizeDayRaw(markdownDay.raw, markdownDay.dayNum) : "",
          };
        });
      }
      if (!legacyEnabled) return [];
      return rawDaySections.map((day) => ({
        ...day,
        displayRaw: sanitizeDayRaw(day.raw, day.dayNum),
      }));
    },
    [isHybridMode, legacyEnabled, tripDocumentDays, rawDaySectionMap, rawDaySections]
  );
  const sortableDayIds = useMemo(
    () => (isHybridMode ? tripDocumentDays.map((day) => day.id) : structuredPlanDays.map((day) => `day-${day.day}`)),
    [isHybridMode, structuredPlanDays, tripDocumentDays]
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
    const byDay = structuredDays.length
      ? structuredDays
          .map((day) => {
            const analysis = analyzeStructuredDay(day);
            return {
              dayNum: day.day,
              title: day.theme,
              summary: day.summary,
              activityCount: day.activities.length,
              ...analysis,
            };
          })
      : daySections.map((section) => ({
          dayNum: section.dayNum,
          title: section.title,
          summary: "",
          ...analyzeLegacyDay(section.displayRaw),
        }));
    const source: "structured" | "legacy" = structuredDays.length ? "structured" : "legacy";
    return { byDay, source };
  }, [structuredDays, daySections]);
  const hybridEditorDays = useMemo(
    () =>
      isHybridMode
        ? daySections.map(({ dayNum, title, raw }) => {
            const structuredDay = structuredDays.find((day) => day.day === dayNum);
            const sectionViewModels = sectionViewModelsByDay.get(dayNum) ?? [];
            const dayMemo = data.dayMemos?.[String(dayNum)]?.trim() || "";
            const analysis = feasibility.byDay.find((item) => item.dayNum === dayNum) ?? null;
            const status = analysis ? getStatus(analysis.warnings, analysis.totalMinutes, analysis.moveRatio) : null;

            return {
              sortableId: `day-${dayNum}`,
              dayNum,
              title,
              raw,
              dayMemo,
              structuredSummary: structuredDay?.summary,
              analysis,
              status,
              sectionViewModels,
            };
          })
        : [],
    [isHybridMode, daySections, structuredDays, sectionViewModelsByDay, data.dayMemos, feasibility.byDay]
  );

  const mapDays = useMemo(() => {
    const structuredDays = (data.structuredPlan?.days ?? [])
      .map((day) => day.day)
      .filter((day): day is number => Number.isInteger(day) && day > 0);
    if (structuredDays.length > 0) {
      return Array.from(new Set(structuredDays)).sort((a, b) => a - b);
    }
    const days = Array.from(new Set(mapPoints.map((p) => p.dayNum ?? 1)));
    return days.sort((a, b) => a - b);
  }, [data.structuredPlan?.days, mapPoints]);

  useEffect(() => {
    if (!mapDays.length) {
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
  }, [mapDays, mapDay]);

  useEffect(() => {
    if (!pendingReorder) return;
    persistItinerary({
      ...data,
      structuredPlan: pendingReorder.structuredPlan,
      finalItinerary: pendingReorder.finalItinerary,
      dayMemos: pendingReorder.dayMemos,
      generatedAt: new Date().toISOString(),
    });
    setPendingReorder(null);
    setFocusedPlace(null);
    setSectionStatuses({});
    setMapDay(null);
  }, [data, pendingReorder, persistItinerary]);

  const handleDayDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (regeneratingDay !== null) return;
      const { active, over } = event;
      if (!over) return;
      if (active.id === over.id) return;

      const fromIndex = structuredPlanDays.findIndex((day) => `day-${day.day}` === String(active.id));
      const toIndex = structuredPlanDays.findIndex((day) => `day-${day.day}` === String(over.id));

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

      setPendingReorder({
        structuredPlan: reorderStructuredPlanDays(data.structuredPlan, fromIndex, toIndex),
        finalItinerary: reorderFinalItineraryDays(data.finalItinerary, fromIndex, toIndex),
        dayMemos: reorderDayMemoMap(data.dayMemos, fromIndex, toIndex, structuredPlanDays.length),
      });
    },
    [data.dayMemos, data.finalItinerary, data.structuredPlan, regeneratingDay, structuredPlanDays]
  );

  const replaceSection = useCallback(
    async (dayNum: number, sectionKey: SectionKey) => {
      const sectionTitle = HYBRID_SECTION_TITLES[sectionKey];
      const stateKey = getSectionStateKey(dayNum, sectionKey);
      setSectionStatuses((prev) => ({ ...prev, [stateKey]: "regenerating" }));

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
            sectionKey,
            sectionTitle,
            dayMarkdown: day.raw,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setSectionStatuses((prev) => ({ ...prev, [stateKey]: "error" }));
          alert(json.error || "섹션 재생성에 실패했습니다.");
          return;
        }
        const returnedSectionKey = typeof json.sectionKey === "string" ? json.sectionKey : sectionKey;
        const returnedIntent = typeof json.intent === "string" ? json.intent.trim() : "";
        const newBlock = typeof json.markdown === "string" ? json.markdown.trim() : "";
        if (!newBlock) {
          setSectionStatuses((prev) => ({ ...prev, [stateKey]: "error" }));
          alert("섹션 재생성 결과가 비어 있습니다. 잠시 후 다시 시도해 주세요.");
          return;
        }
        const updated = replaceSectionInDay(data.markdown, dayNum, sectionTitle, newBlock);
        if (!updated || updated === data.markdown) {
          setSectionStatuses((prev) => ({ ...prev, [stateKey]: "error" }));
          alert("섹션 재생성 결과를 적용하지 못했습니다. Day 헤더 형식을 확인해 주세요.");
          return;
        }
        const patchedStructuredPlan = patchStructuredSectionIntent(
          data.structuredPlan,
          dayNum,
          returnedSectionKey as SectionKey,
          returnedIntent || `${sectionTitle} 추천 코스`
        );

        const activeSectionKey = returnedSectionKey as SectionKey;
        let mergedFinalItinerary = data.finalItinerary;
        let shouldWarnPlacesRefreshFailure = false;

        if (patchedStructuredPlan) {
          const nextFinalItinerary = await fetchTargetSectionPlaces({
            structuredPlan: patchedStructuredPlan,
            city: data.payload.city,
            country: data.payload.country,
            dayNum,
            sectionKey: activeSectionKey,
          });

          if (nextFinalItinerary) {
            mergedFinalItinerary = mergeSectionPlaces(
              data.finalItinerary,
              nextFinalItinerary,
              dayNum,
              activeSectionKey
            );
          } else {
            shouldWarnPlacesRefreshFailure = true;
          }
        } else {
          shouldWarnPlacesRefreshFailure = true;
        }

        const next: StoredItinerary = {
          ...data,
          markdown: updated,
          structuredPlan: patchedStructuredPlan,
          finalItinerary: mergedFinalItinerary,
          generatedAt: new Date().toISOString(),
        };
        const normalizedNext = normalizeStoredForView(next);
        const nextTripDocument = applyReplaceSectionPatch(
          tripDocumentRef.current,
          normalizedNext,
          dayNum,
          activeSectionKey
        );
        persistItinerary(normalizedNext, nextTripDocument);
        if (shouldWarnPlacesRefreshFailure) {
          alert("장소 추천 갱신에 실패해 기존 장소를 유지합니다.");
        }
        setSectionStatuses((prev) => {
          const nextStatus = { ...prev };
          delete nextStatus[stateKey];
          return nextStatus;
        });
      } catch {
        setSectionStatuses((prev) => ({ ...prev, [stateKey]: "error" }));
        alert("네트워크 오류입니다.");
      }
    },
    [data, rawDaySections, persistItinerary]
  );

  const replaceSectionLegacy = useCallback(
    async (dayNum: number, sectionTitle: string) => {
      const mappedKey = SECTION_TITLE_TO_KEY[sectionTitle];
      if (mappedKey) {
        await replaceSection(dayNum, mappedKey);
        return;
      }
      alert("유효한 섹션명을 찾지 못했습니다.");
    },
    [replaceSection]
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
    persistItinerary({
      ...data,
      dayMemos: {
        ...(data.dayMemos ?? {}),
        [String(dayNum)]: note,
      },
      generatedAt: new Date().toISOString(),
    });
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
    const patchedStructuredPlan = patchStructuredDayFromMarkdown(data.structuredPlan, dayNum, newBlock);
    persistItinerary({
      ...data,
      markdown: updated,
      structuredPlan: patchedStructuredPlan,
      itinerary: undefined,
      generatedAt: new Date().toISOString(),
    });
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
    const nextStructuredPlan = appendDayToStructuredPlan(data.structuredPlan, nextDay);
    const nextFinalItinerary = appendDayToFinalItinerary(data.finalItinerary, nextStructuredPlan, nextDay);
    persistItinerary({
      ...data,
      payload: { ...data.payload, nights: nextNights },
      itinerary: undefined,
      structuredPlan: nextStructuredPlan,
      finalItinerary: nextFinalItinerary,
      markdown: updated,
      generatedAt: new Date().toISOString(),
    });
    setCopyMessage(`Day ${nextDay}를 추가했습니다.`);
    setTimeout(() => setCopyMessage(null), 2000);
  };

  const removeDay = (dayNum: number) => {
    if ((data.structuredPlan?.days?.length ?? 0) <= 1) {
      alert("최소 하루 일정은 필요합니다.");
      return;
    }
    const confirmed = window.confirm(`Day ${dayNum} 일정을 삭제할까요?`);
    if (!confirmed) return;
    const removed = removeDayFromMarkdown(data.markdown, dayNum);
    const updated = rebuildDaysSequential(removed);
    if (!updated || updated === data.markdown) return;
    const nextNights = getNightsFromMarkdown(updated);
    const nextStructuredPlan = removeDayFromStructuredPlan(data.structuredPlan, dayNum);
    const nextFinalItinerary = removeDayFromFinalItinerary(data.finalItinerary, dayNum);
    const nextDayMemos = removeDayMemoMap(data.dayMemos, dayNum);
    persistItinerary({
      ...data,
      payload: { ...data.payload, nights: nextNights },
      itinerary: undefined,
      structuredPlan: nextStructuredPlan,
      finalItinerary: nextFinalItinerary,
      dayMemos: nextDayMemos,
      markdown: updated,
      generatedAt: new Date().toISOString(),
    });
    setSectionStatuses({});
    setCopyMessage(`Day ${dayNum} 일정을 삭제했습니다.`);
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
    if (data.structuredPlan?.days?.length) {
      let nextOrder = 1;
      const points = tripDocumentDays
        .flatMap((day) =>
          day.sections.flatMap((section) =>
            section.places
              .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng))
              .map((place) => ({
                id: place.id,
                name: place.name,
                lat: Number(place.lat),
                lon: Number(place.lng),
                address: place.address,
                dayNum: day.dayNumber,
                order: nextOrder++,
                section: section.title,
                sectionKey: section.key,
              }))
          )
        ) satisfies MapPoint[];

      setMapProvider("google_places");
      setMapPoints(points);
      setMapError(points.length > 0 ? null : "지도에 표시할 장소가 없습니다.");
      return;
    }

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

  const focusPlaceOnMap = async (dayNum: number, name: string, placeId?: string) => {
    if (!mapPoints.length) {
      await loadMapPoints();
    }
    setMapDay(dayNum);
    setFocusedPlace({ dayNum, name, placeId });
    mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleMarkerCardScroll = useCallback((order: number) => {
    document.getElementById(`place-${order}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, []);

  const placeOrderLookup = useMemo(() => {
    const lookup = new Map<string, number>();
    mapPoints.forEach((point, idx) => {
      const order = point.order ?? idx + 1;
      const key = point.id ?? `${point.dayNum ?? 1}::${point.section ?? ""}::${point.name.trim().toLowerCase()}`;
      if (!lookup.has(key)) {
        lookup.set(key, order);
      }
    });
    return lookup;
  }, [mapPoints]);

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
    void loadMapPoints(true);
  }, [data.markdown, data.structuredPlan, data.finalItinerary, tripDocumentDays]);

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
            onClick={() => void saveTrip()}
            disabled={savingTrip || auth.status === "loading"}
            className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:opacity-60"
          >
            {savingTrip ? "저장 중..." : auth.status === "authenticated" ? "내 일정에 저장" : "로그인 후 저장"}
          </button>
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
      {saveMessage && (
        <div data-print="hide" className="mb-4 rounded-xl bg-violet-50 px-4 py-2 text-sm text-violet-800">
          {saveMessage}
        </div>
      )}
      {regeneratingDay !== null && (
        <div data-print="hide" className="mb-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          <div>
            {`Day ${regeneratingDay} 일정 재생성 중입니다...`}
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

      <section ref={mapSectionRef} data-print="hide" className="mb-6 rounded-2xl border border-white/30 bg-white/80 p-4 shadow-lg">
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
      {mapDays.length > 0 && (
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
          {mapPoints.length > 0 ? (
            <ItineraryMap
              points={mapPoints}
              selectedDay={mapDay ?? "all"}
              focusedPlace={focusedPlace}
              onMarkerClick={handleMarkerCardScroll}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-8 text-center text-xs text-slate-500">
              선택한 Day에 표시할 장소가 없습니다.
            </div>
          )}
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
            {feasibility.byDay.map((d, checkIdx) => (
              <div
                key={`check-${d.dayNum}-${checkIdx}-${d.title}`}
                className="rounded-xl border border-slate-200 bg-white px-3 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-slate-700">
                    <span className="font-medium text-slate-900">Day {d.dayNum}</span>
                    <span className="ml-2">{d.title}</span>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatus(d.warnings, d.totalMinutes, d.moveRatio).tone}`}>
                    {getStatus(d.warnings, d.totalMinutes, d.moveRatio).label}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                  <div>활동 수: {d.activityCount}개</div>
                  <div>총 체류 시간: {formatDuration(d.totalStay)}</div>
                  <div>총 이동 시간: {formatDuration(d.totalMove)}</div>
                  <div>총 소요 시간: {formatDuration(d.totalMinutes)}</div>
                  <div>이동 비율: {(d.moveRatio * 100).toFixed(1)}%</div>
                </div>
                {d.warnings.length > 0 && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setExpandedWarningDay((prev) => (prev === d.dayNum ? null : d.dayNum))}
                      className="text-xs font-medium text-amber-700 hover:underline"
                    >
                      {expandedWarningDay === d.dayNum ? "경고 숨기기" : `경고 보기 (${d.warnings.length})`}
                    </button>
                    {expandedWarningDay === d.dayNum && (
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-800">
                        {d.warnings.map((warning, idx) => (
                          <li key={`warn-${d.dayNum}-${idx}`}>{warning}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">구조화 일정 데이터가 없어 상세 체크를 건너뛰었습니다.</p>
        )}
        {feasibility.source === "legacy" && (
          <p className="mt-2 text-xs text-slate-500">
            현재는 구조화 일정(JSON)이 없어 보조 휴리스틱 결과를 표시합니다.
          </p>
        )}
      </section>

      {regeneratingDay !== null ? (
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
          {isHybridMode ? (
            <TripEditor
              sensors={sensors}
              collisionDetection={closestCenter}
              sortableDayIds={sortableDayIds}
              days={hybridEditorDays}
              placeOrderLookup={placeOrderLookup}
              regeneratingDay={regeneratingDay}
              editingDay={editingDay}
              editText={editText}
              noteEditingDay={noteEditingDay}
              noteEditText={noteEditText}
              expandedWarningDay={expandedWarningDay}
              onDragEnd={handleDayDragEnd}
              onToggleWarning={(dayNum) => setExpandedWarningDay((prev) => (prev === dayNum ? null : dayNum))}
              onStartEditDay={startEditDay}
              onAddNoteToDay={addNoteToDay}
              onReplaceDay={replaceDay}
              onRemoveDay={removeDay}
              onEditTextChange={setEditText}
              onSaveEditDay={saveEditDay}
              onCancelEditDay={cancelEditDay}
              onNoteEditTextChange={setNoteEditText}
              onSaveNoteToDay={saveNoteToDay}
              onCancelNoteDay={cancelNoteDay}
              onReplaceSection={(dayNum, sectionKey) => void replaceSection(dayNum, sectionKey as SectionKey)}
              onFocusPlace={focusPlaceOnMap}
              formatDuration={formatDuration}
            />
          ) : (
            daySections.map(({ dayNum, title, raw, displayRaw }, dayIdx) => {
              const structuredDay = structuredDays.find((day) => day.day === dayNum);
              const grouped = structuredDay ? groupActivitiesForUI(structuredDay.activities) : null;
              const legacyGrouped = structuredDay ? null : parseActivitiesFromMarkdownDay(displayRaw);
              const analysis = feasibility.byDay.find((item) => item.dayNum === dayNum);
              const status = analysis ? getStatus(analysis.warnings, analysis.totalMinutes, analysis.moveRatio) : null;
              const visibleScheduleSections = grouped
                ? (["아침 일정", "점심 일정", "저녁 일정"] as const).filter((sectionTitle) => grouped.schedule[sectionTitle].length > 0)
                : [];
              const visibleMealSections = grouped
                ? (["점심 식사 장소 추천", "저녁 식사 장소 추천"] as const).filter(
                    (sectionTitle) => grouped.mealRecs[sectionTitle].length > 0
                  )
                : [];
              const visibleLegacySections: Array<"오전" | "점심" | "오후" | "저녁" | "밤"> = legacyGrouped
                ? (["오전", "점심", "오후", "저녁", "밤"] as const).filter((sectionTitle) => legacyGrouped[sectionTitle].length > 0)
                : [];

              return (
                <article
                  key={`day-card-${dayNum}-${dayIdx}-${title}`}
                  data-print="day-card"
                  className="rounded-3xl border border-white/20 bg-white/90 p-5 shadow-xl backdrop-blur sm:p-8"
                >
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Day {dayNum} · {title}</h2>
                    {structuredDay?.summary && (
                      <p className="mt-1 text-sm text-slate-600">{structuredDay.summary}</p>
                    )}
                    {analysis && (
                      <p className="mt-2 text-xs text-slate-500">
                        총 체류 {formatDuration(analysis.totalStay)} · 이동 {formatDuration(analysis.totalMove)} · 총{" "}
                        {formatDuration(analysis.totalMinutes)} · 이동 비율 {(analysis.moveRatio * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>
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
                      메모
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

                {status && (
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>
                      {status.label}
                    </span>
                    {analysis && analysis.warnings.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpandedWarningDay((prev) => (prev === dayNum ? null : dayNum))}
                        className="text-xs font-medium text-amber-700 hover:underline"
                      >
                        {expandedWarningDay === dayNum ? "경고 숨기기" : `경고 보기 (${analysis.warnings.length})`}
                      </button>
                    )}
                  </div>
                )}
                {analysis && analysis.warnings.length > 0 && expandedWarningDay === dayNum && (
                  <ul className="mb-3 list-disc space-y-1 pl-5 text-xs text-amber-800">
                    {analysis.warnings.map((warning, idx) => (
                      <li key={`warn-list-${dayNum}-${idx}`}>{warning}</li>
                    ))}
                  </ul>
                )}
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
                        onClick={() => void replaceSectionLegacy(dayNum, sectionTitle)}
                        className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 transition hover:bg-amber-200 disabled:opacity-60"
                      >
                        {`${sectionTitle} 다시 만들기`}
                      </button>
                    ))}
                  </div>
                )}

                {grouped ? (
                  <div className="space-y-4">
                    {visibleScheduleSections.map((sectionTitle) => (
                      <section key={`day-${dayNum}-${sectionTitle}`} className="space-y-2">
                        <h3 className="text-base font-semibold text-violet-800">{sectionTitle}</h3>
                        <div className="space-y-2">
                          {grouped.schedule[sectionTitle].map((activity, idx) => (
                            <article
                              key={`activity-${dayNum}-${sectionTitle}-${idx}-${activity.name}`}
                              id={`place-${
                                placeOrderLookup.get(
                                  `${dayNum}::${sectionTitle}::${activity.name.trim().toLowerCase()}`
                                ) ?? `missing-${dayNum}-schedule-${idx}`
                              }`}
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    <span className="mr-1">{activityIcon(activity.type)}</span>
                                    {activity.name}
                                  </p>
                                  {getActivityDescription(activity) ? (
                                    <p className="mt-1 text-sm text-slate-600">{getActivityDescription(activity)}</p>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => focusPlaceOnMap(dayNum, activity.name)}
                                  className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                                >
                                  ?? 지도
                                </button>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <span className="rounded-full bg-violet-100 px-2.5 py-1 font-medium text-violet-800">
                                  ? 체류 {formatDuration(activity.stayMinutes)}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
                                  ?? 이동 {formatDuration(activity.moveMinutesToNext)}
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}

                    {visibleMealSections.map((sectionTitle) => (
                      <section key={`day-${dayNum}-${sectionTitle}`} className="space-y-2">
                        <h3 className="text-base font-semibold text-rose-700">{sectionTitle}</h3>
                        <div className="space-y-2">
                          {grouped.mealRecs[sectionTitle].map((activity, idx) => (
                            <article
                              key={`activity-${dayNum}-${sectionTitle}-${idx}-${activity.name}`}
                              id={`place-${
                                placeOrderLookup.get(
                                  `${dayNum}::${sectionTitle}::${activity.name.trim().toLowerCase()}`
                                ) ?? `missing-${dayNum}-meal-${idx}`
                              }`}
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    <span className="mr-1">{activityIcon(activity.type)}</span>
                                    {activity.name}
                                  </p>
                                  {getActivityDescription(activity) ? (
                                    <p className="mt-1 text-sm text-slate-600">{getActivityDescription(activity)}</p>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => focusPlaceOnMap(dayNum, activity.name)}
                                  className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                                >
                                  📍 지도
                                </button>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <span className="rounded-full bg-violet-100 px-2.5 py-1 font-medium text-violet-800">
                                  ⏱ 체류 {formatDuration(activity.stayMinutes)}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
                                  🚶 이동 {formatDuration(activity.moveMinutesToNext)}
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : visibleLegacySections.length > 0 ? (
                  <div className="space-y-4">
                    {visibleLegacySections.map((sectionTitle) => (
                      <section key={`day-${dayNum}-${sectionTitle}`} className="space-y-2">
                        <h3 className="text-base font-semibold text-violet-800">{sectionTitle}</h3>
                        <div className="space-y-2">
                          {legacyGrouped![sectionTitle].map((activity, idx) => (
                            <article
                              key={`activity-${dayNum}-${sectionTitle}-${idx}-${activity.name}`}
                              id={`place-${
                                placeOrderLookup.get(
                                  `${dayNum}::${sectionTitle}::${activity.name.trim().toLowerCase()}`
                                ) ?? `missing-${dayNum}-legacy-${idx}`
                              }`}
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    <span className="mr-1">{activityIcon(activity.type)}</span>
                                    {activity.name}
                                  </p>
                                  {getActivityDescription(activity) ? (
                                    <p className="mt-1 text-sm text-slate-600">{getActivityDescription(activity)}</p>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => focusPlaceOnMap(dayNum, activity.name)}
                                  className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                                >
                                  ?? 지도
                                </button>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <span className="rounded-full bg-violet-100 px-2.5 py-1 font-medium text-violet-800">
                                  ? 체류 {formatDuration(activity.stayMinutes)}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
                                  ?? 이동 {formatDuration(activity.moveMinutesToNext)}
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : legacyEnabled ? (
                  <MarkdownBlock>{renderMarkdown(displayRaw)}</MarkdownBlock>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    구조화 일정 데이터만 표시 중입니다.
                  </div>
                )}
              </article>
            );
          })
        )}
        </div>
      ) : hasStructuredPlan || !legacyEnabled ? (
        <article data-print="day-card" className="rounded-3xl border border-white/20 bg-white/90 p-6 shadow-xl backdrop-blur sm:p-8">
          <p className="text-sm text-slate-600">구조화 일정 데이터가 없습니다.</p>
        </article>
      ) : (
        <article data-print="day-card" className="rounded-3xl border border-white/20 bg-white/90 p-6 shadow-xl backdrop-blur sm:p-8">
          <MarkdownBlock>{renderMarkdown(data.markdown)}</MarkdownBlock>
        </article>
      )}
    </div>
  );
}


