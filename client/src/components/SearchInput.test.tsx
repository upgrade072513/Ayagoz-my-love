/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchInput } from "./SearchInput";
import { SearchEmptyState } from "./SearchEmptyState";

describe("SearchInput", () => {
  it("renders a labeled input and reports typed search text", () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} placeholder="ФИО, объект или тариф" />);
    const input = screen.getByPlaceholderText("ФИО, объект или тариф");
    expect(screen.getByText("Поиск")).toBeTruthy();
    fireEvent.change(input, { target: { value: "Иван" } });
    expect(onChange).toHaveBeenCalledWith("Иван");
  });

  it("shows clear action only for a non-empty query and clears it", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchInput value="Иван" onChange={onChange} placeholder="Поиск" />);
    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));
    expect(onChange).toHaveBeenCalledWith("");
    rerender(<SearchInput value="" onChange={onChange} placeholder="Поиск" />);
    expect(screen.queryByRole("button", { name: "Очистить" })).toBeNull();
  });

  it("renders a distinct empty state for no rows and no matches", () => {
    const { rerender } = render(<SearchEmptyState hasRows={false} hasMatches={false} emptyMessage="История пуста" noMatchesMessage="Ничего не найдено" />);
    expect(screen.getByText("История пуста")).toBeTruthy();
    rerender(<SearchEmptyState hasRows={true} hasMatches={false} emptyMessage="История пуста" noMatchesMessage="Ничего не найдено" />);
    expect(screen.getByText("Ничего не найдено")).toBeTruthy();
    rerender(<SearchEmptyState hasRows={true} hasMatches={true} emptyMessage="История пуста" noMatchesMessage="Ничего не найдено" />);
    expect(screen.queryByText("Ничего не найдено")).toBeNull();
  });
});
