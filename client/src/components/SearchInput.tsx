import React from "react";
import { Search, X } from "lucide-react";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
};

/** iOS-style search field: magnifier inside, clear button on the right, label for screen readers only. */
export function SearchInput({ value, onChange, placeholder, label = "Поиск" }: SearchInputProps) {
  return (
    <label className="relative flex h-9 min-w-[240px] items-center rounded-[10px] bg-[var(--app-fill)]" style={{ color: "var(--app-fg-2)" }}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4" aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-full w-full min-w-0 rounded-[10px] border-0 bg-transparent pl-8 pr-8 text-sm outline-none focus:ring-2 focus:ring-[var(--app-accent)]"
      />
      {value && (
        <button
          type="button"
          aria-label="Очистить"
          className="absolute right-1.5 flex h-6 w-6 items-center justify-center rounded-full hover:bg-[var(--app-fill)]"
          onClick={() => onChange("")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </label>
  );
}
