import { describe, expect, it } from "vitest";
import XLSX from "xlsx-js-style";
import { autoFitColumns } from "./excelExport";

describe("Excel report column widths", () => {
  it("fit the content; merged titles and totals do not widen a column", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Очень длинный заголовок отчёта, который объединён на всю ширину"],
      [],
      ["№", "ФИО", "Сумма отчета за период (с учетом НДС) в тенге"],
      [1, "Байназарова Аружан Талгатовна", 1234567.89],
      [],
      ["ИТОГО за расчетный период", "", 1234567.89],
    ]);
    sheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } },
    ];
    autoFitColumns(sheet);
    const widths = (sheet["!cols"] ?? []).map(col => col.wch);
    expect(widths[0]).toBeLessThan(10); // «№»
    expect(widths[1]).toBeGreaterThanOrEqual("Байназарова Аружан Талгатовна".length);
    expect(widths[2]).toBeGreaterThanOrEqual("1 234 567,89".length);
    expect(widths[2]).toBeLessThan(30); // header wraps instead of stretching
    expect(sheet["!rows"]?.[2]?.hpt).toBeGreaterThan(20);
  });
});
