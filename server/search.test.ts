import { describe, expect, it } from "vitest";
import { filterBySearch, matchesSearch, normalizeSearchText, visibleContractStatusLabel, visibleEmailStatusLabel, visibleTariffLabel } from "@shared/search";

describe("search helpers", () => {
  it("matches case-insensitively across Russian text and numeric values", () => {
    expect(matchesSearch("иван", ["Иван Иванов", "buyer@example.com"])).toBe(true);
    expect(matchesSearch("116000", ["Счёт", 116000])).toBe(true);
    expect(matchesSearch("portal", ["Reception Desk", "NU Portal"])).toBe(true);
  });

  it("supports dates and treats an empty query as match all", () => {
    const date = new Date("2026-08-10T00:00:00.000Z");
    expect(normalizeSearchText(date)).toContain("2026-08-10");
    expect(matchesSearch("", ["любая строка"])).toBe(true);
  });

  it("returns false when none of the visible values contain the query", () => {
    expect(matchesSearch("не найдено", ["Иван Иванов", "Блок A1", "2026-08"])).toBe(false);
  });

  it("filters contract rows by labels visible in the contracts table", () => {
    const rows = [{ tenantName: "Анна", status: "active", tariffType: "daily" }, { tenantName: "Борис", status: "ended", tariffType: "monthly" }];
    expect(filterBySearch(rows, "за сутки", row => [row.tenantName, visibleContractStatusLabel(row.status), visibleTariffLabel(row.tariffType)])).toEqual([rows[0]]);
    expect(filterBySearch(rows, "Завершён", row => [row.tenantName, visibleContractStatusLabel(row.status), visibleTariffLabel(row.tariffType)])).toEqual([rows[1]]);
  });

  it("filters invoice rows by visible email status labels", () => {
    const rows = [{ invoiceNumber: "СЧ-1", emailStatus: "sent" }, { invoiceNumber: "СЧ-2", emailStatus: "failed" }];
    expect(filterBySearch(rows, "Отправлен", row => [row.invoiceNumber, visibleEmailStatusLabel(row.emailStatus)])).toEqual([rows[0]]);
    expect(filterBySearch(rows, "Ошибка", row => [row.invoiceNumber, visibleEmailStatusLabel(row.emailStatus)])).toEqual([rows[1]]);
  });
});
