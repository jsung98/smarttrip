"use client";

import { DndContext, type DragEndEvent, type DndContextProps } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";
import DayCard from "@/components/itinerary/DayCard";

type TripEditorDay = {
  sortableId: string;
  dayNum: number;
  title: string;
  raw: string;
  dayMemo: string;
  structuredSummary?: string | null;
  analysis: {
    warnings: string[];
    totalStay: number;
    totalMove: number;
    totalMinutes: number;
    moveRatio: number;
  } | null;
  status: {
    tone: string;
    label: string;
  } | null;
  sectionViewModels: Array<{
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
  }>;
};

type SortableDayCardProps = {
  id: string;
  children: (params: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
    setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"];
    isDragging: boolean;
  }) => ReactNode;
};

function SortableDayCard({ id, children }: SortableDayCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  );
}

type TripEditorProps = {
  sensors: DndContextProps["sensors"];
  collisionDetection: DndContextProps["collisionDetection"];
  sortableDayIds: string[];
  days: TripEditorDay[];
  placeOrderLookup: Map<string, number>;
  regeneratingDay: number | null;
  editingDay: number | null;
  editText: string;
  noteEditingDay: number | null;
  noteEditText: string;
  expandedWarningDay: number | null;
  onDragEnd: (event: DragEndEvent) => void;
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
  formatDuration: (value: number) => string;
};

export default function TripEditor({
  sensors,
  collisionDetection,
  sortableDayIds,
  days,
  placeOrderLookup,
  regeneratingDay,
  editingDay,
  editText,
  noteEditingDay,
  noteEditText,
  expandedWarningDay,
  onDragEnd,
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
  formatDuration,
}: TripEditorProps) {
  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
      <SortableContext items={sortableDayIds} strategy={verticalListSortingStrategy}>
        {days.map((day, dayIdx) => (
          <SortableDayCard key={`day-card-${day.dayNum}-${dayIdx}-${day.title}`} id={day.sortableId}>
            {({ attributes, listeners, setActivatorNodeRef, isDragging }) => (
              <DayCard
                dayNum={day.dayNum}
                title={day.title}
                raw={day.raw}
                dayMemo={day.dayMemo}
                structuredSummary={day.structuredSummary}
                analysis={day.analysis}
                status={day.status}
                expandedWarningDay={expandedWarningDay}
                isDragging={isDragging}
                dragHandle={
                  <button
                    ref={setActivatorNodeRef}
                    type="button"
                    aria-label={`Day ${day.dayNum} 순서 이동`}
                    className="cursor-grab rounded-lg bg-slate-100 px-2.5 py-1.5 text-base font-semibold text-slate-500 transition hover:bg-slate-200 active:cursor-grabbing"
                    {...attributes}
                    {...listeners}
                  >
                    ☰
                  </button>
                }
                editingDay={editingDay}
                editText={editText}
                noteEditingDay={noteEditingDay}
                noteEditText={noteEditText}
                sectionViewModels={day.sectionViewModels}
                placeOrderLookup={placeOrderLookup}
                onToggleWarning={onToggleWarning}
                onStartEditDay={onStartEditDay}
                onAddNoteToDay={onAddNoteToDay}
                onReplaceDay={onReplaceDay}
                onRemoveDay={onRemoveDay}
                onEditTextChange={onEditTextChange}
                onSaveEditDay={onSaveEditDay}
                onCancelEditDay={onCancelEditDay}
                onNoteEditTextChange={onNoteEditTextChange}
                onSaveNoteToDay={onSaveNoteToDay}
                onCancelNoteDay={onCancelNoteDay}
                onReplaceSection={onReplaceSection}
                onFocusPlace={onFocusPlace}
                regeneratingDay={regeneratingDay}
                formatDuration={formatDuration}
              />
            )}
          </SortableDayCard>
        ))}
      </SortableContext>
    </DndContext>
  );
}
