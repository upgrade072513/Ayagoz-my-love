import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
};

export function SearchInput({ value, onChange, placeholder, label = "Поиск" }: SearchInputProps) {
  return (
    <div className="min-w-[240px]">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {value && <button type="button" className="text-xs text-[#9a7633] hover:underline" onClick={() => onChange("")}>Очистить</button>}
      </div>
      <Input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}
