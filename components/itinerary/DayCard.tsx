"use client";

import type { ReactNode } from "react";
import SectionCard from "@/components/itinerary/SectionCard";

type DayStatus = {
  tone: string;
  label: string;
};

type DayAnalysis = {
  warnings: string[];
  totalStay: number;
  totalMove: number;
  totalMinutes: number;
  moveRatio: number;
};

type SectionData = {
  sectionKey: string;
  title: string;
  type: "tour" | "meal";
  status: "ready" | "loading" | "empty" | "error" | "regenerating";
  places: Array<{
    id?: string;
    name: string;
    rating: number;
    address?: string;
    mapsUrl?: string;
  }>;
};

type DayCardProps = {
  dayNum: number;
  title: string;
  raw: string;
  dayMemo: string;
  structuredSummary?: string | null;
  analysis: DayAnalysis | null;
  status: DayStatus | null;
  expandedWarningDay: number | null;
  isDragging: boolean;
  dragHandle: ReactNode;
  editingDay: number | null;
  editText: string;
  noteEditingDay: number | null;
  noteEditText: string;
  sectionViewModels: SectionData[];
  placeOrderLookup: Map<string, number>;
  onToggleWarning: (dayNum: number) => void;
  onStartEditDay: (dayNum: number, raw: string) => void;
  onAddNoteToDay: (dayNum: number) => void;
  onReplaceDay: (dayNum: number) => void;
  onRemoveDay: (dayNum: number) => void;
  onEditTextChange: (value: string) => void;
  onSaveEditDay: (dayNum: number, title: string) => void;
  onCancelEditDay: () => void;
  onNoteEditTextChange: (value: string) => void;
  onSaveNoteToDay: (dayNum: number) => void;
  onCancelNoteDay: () => void;
  onReplaceSection: (dayNum: number, sectionKey: string) => void;
  onFocusPlace: (dayNum: number, name: string, placeId?: string) => void;
  regeneratingDay: number | null;
  formatDuration: (value: number) => string;
};

const HYBRID_SECTION_TITLES: Record<string, string> = {
  morning: "오전",
  lunch: "점심",
  afternoon: "오후",
  dinner: "저녁",
  night: "밤",
};

export default function DayCard({
  dayNum,
  title,
  raw,
  dayMemo,
  structuredSummary,
  analysis,
  status,
  expandedWarningDay,
  isDragging,
  dragHandle,
  editingDay,
  editText,
  noteEditingDay,
  noteEditText,
  sectionViewModels,
  placeOrderLookup,
  onToggleWarning,
  onStartEditDay,
  onAddNoteToDay,
  onReplaceDay,
  onRemoveDay,
  onEditTextChange,
  onSaveEditDay,
  onCancelEditDay,
  onNoteEditTextChange,
  onSaveNoteToDay,
  onCancelNoteDay,
  onReplaceSection,
  onFocusPlace,
  regeneratingDay,
  formatDuration,
}: DayCardProps) {
  return (
    <article
      data-print="day-card"
      className={`rounded-3xl border border-white/20 bg-white/90 p-5 shadow-xl backdrop-blur sm:p-8 ${
        isDragging ? "ring-2 ring-violet-200" : ""
      }`}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {dragHandle}
          <div>
            <h2 className="text-xl font-bold text-slate-900">Day {dayNum} · {title}</h2>
            {structuredSummary ? <p className="mt-1 text-sm text-slate-600">{structuredSummary}</p> : null}
            {analysis ? (
              <p className="mt-2 text-xs text-slate-500">
                총 체류 {formatDuration(analysis.totalStay)} · 이동 {formatDuration(analysis.totalMove)} · 총{" "}
                {formatDuration(analysis.totalMinutes)} · 이동 비율 {(analysis.moveRatio * 100).toFixed(1)}%
              </p>
            ) : null}
          </div>
        </div>
        <div data-print="hide" className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onStartEditDay(dayNum, raw)}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
          >
            편집
          </button>
          <button
            type="button"
            onClick={() => onAddNoteToDay(dayNum)}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
          >
            메모
          </button>
          <button
            type="button"
            onClick={() => onReplaceDay(dayNum)}
            disabled={regeneratingDay === dayNum}
            className="rounded-lg bg-violet-100 px-3 py-1.5 text-sm font-medium text-violet-700 transition hover:bg-violet-200 disabled:opacity-50"
          >
            {regeneratingDay === dayNum ? "생성 중..." : "이 날 다시 만들기"}
          </button>
          <button
            type="button"
            onClick={() => onRemoveDay(dayNum)}
            className="rounded-lg bg-rose-100 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-200"
          >
            이 날 삭제
          </button>
        </div>
      </div>

      {status ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>
          {analysis && analysis.warnings.length > 0 ? (
            <button
              type="button"
              onClick={() => onToggleWarning(dayNum)}
              className="text-xs font-medium text-amber-700 hover:underline"
            >
              {expandedWarningDay === dayNum ? "경고 숨기기" : `경고 보기 (${analysis.warnings.length})`}
            </button>
          ) : null}
        </div>
      ) : null}
      {analysis && analysis.warnings.length > 0 && expandedWarningDay === dayNum ? (
        <ul className="mb-3 list-disc space-y-1 pl-5 text-xs text-amber-800">
          {analysis.warnings.map((warning, idx) => (
            <li key={`warn-list-${dayNum}-${idx}`}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-900">📝 메모</p>
        <p className="mt-1 whitespace-pre-wrap">{dayMemo || "📝 메모 없음"}</p>
      </div>

      {editingDay === dayNum ? (
        <div className="mb-4 space-y-3">
          <p className="text-xs text-slate-500">제목은 고정입니다. 본문만 수정하세요.</p>
          <textarea
            value={editText}
            onChange={(e) => onEditTextChange(e.target.value)}
            rows={12}
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSaveEditDay(dayNum, title)}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
            >
              저장
            </button>
            <button
              type="button"
              onClick={onCancelEditDay}
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
            onChange={(e) => onNoteEditTextChange(e.target.value)}
            rows={4}
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
            placeholder="예: 저녁 예약 필요 / 우천 시 실내 대체 코스"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSaveNoteToDay(dayNum)}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
            >
              메모 저장
            </button>
            <button
              type="button"
              onClick={onCancelNoteDay}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div data-print="hide" className="mb-4 flex flex-wrap gap-2">
          {Object.entries(HYBRID_SECTION_TITLES).map(([sectionKey, sectionTitle]) => {
            const sectionState = sectionViewModels.find((section) => section.sectionKey === sectionKey)?.status;
            const isRegeneratingSection = sectionState === "regenerating";
            return (
              <button
                key={`${dayNum}-${sectionKey}`}
                type="button"
                onClick={() => onReplaceSection(dayNum, sectionKey)}
                disabled={isRegeneratingSection}
                className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 transition hover:bg-amber-200 disabled:opacity-60"
              >
                {isRegeneratingSection ? `${sectionTitle} 생성 중...` : `${sectionTitle} 다시 만들기`}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-4">
        {sectionViewModels.map((section) => (
          <SectionCard
            key={`hybrid-${dayNum}-${section.sectionKey}`}
            dayNum={dayNum}
            section={section}
            placeOrderLookup={placeOrderLookup}
            onFocusPlace={onFocusPlace}
          />
        ))}
      </div>
    </article>
  );
}
