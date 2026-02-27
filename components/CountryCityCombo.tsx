"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const MAX_LIST_HEIGHT = 220;

export type ComboOption = string | { value: string; label: string };

function normalizeOptions(options: ComboOption[]): { value: string; label: string }[] {
  return options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

interface ComboProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  loading?: boolean;
  disabled?: boolean;
  required?: boolean;
  "data-testid"?: string;
}

export function Combo({
  label,
  placeholder,
  value,
  onChange,
  options,
  loading,
  disabled,
  required,
  "data-testid": testId,
}: ComboProps) {
  const items = normalizeOptions(options);
  const selectedItem = items.find((o) => o.value === value);
  const displayValue = selectedItem ? selectedItem.label : value;

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(displayValue);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFilter(displayValue);
  }, [displayValue, value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filterLower = filter.trim().toLowerCase();
  const filtered = items.filter(
    (o) =>
      o.label.includes(filter.trim()) ||
      o.label.toLowerCase().includes(filterLower) ||
      o.value.toLowerCase().includes(filterLower)
  );
  const showList = open && (filter.trim() || items.length <= 50);

  const select = useCallback(
    (item: { value: string; label: string }) => {
      onChange(item.value);
      setFilter(item.label);
      setOpen(false);
    },
    [onChange]
  );

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="text-rose-400"> *</span>}
      </label>
      <input
        data-testid={testId}
        type="text"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
        className="w-full rounded-xl border-2 border-slate-200 bg-white/80 px-4 py-3 text-slate-900 placeholder-slate-400 transition focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60"
      />
      {loading && (
        <div className="absolute right-3 top-[38px] h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-violet-500" />
      )}
      {showList && !loading && (
        <ul
          className="absolute z-10 mt-1 max-h-[220px] w-full overflow-auto rounded-xl border-2 border-slate-200 bg-white py-1 shadow-xl"
          style={{ maxHeight: MAX_LIST_HEIGHT }}
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-slate-500">검색 결과 없음</li>
          ) : (
            filtered.slice(0, 150).map((item) => (
              <li key={item.value}>
                <button
                  type="button"
                  className={`w-full px-4 py-2.5 text-left text-sm transition hover:bg-violet-50 ${
                    item.value === value ? "bg-violet-100 font-medium text-violet-800" : "text-slate-700"
                  }`}
                  onClick={() => select(item)}
                >
                  {item.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
