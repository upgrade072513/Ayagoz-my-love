import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseContractsExcel } from "./excelImport";

function workbookBuffer(rows: unknown[][]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Договоры");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseContractsExcel", () => {
  it("parses Russian headers and normalizes dates and tariff type", () => {
    const result = parseContractsExcel(workbookBuffer([["Номер договора", "Дата договора", "Плательщик", "Объект", "Дата начала", "Дата окончания", "Вид тарифа", "Ставка"], ["Д-2026-001", "15.07.2026", "ТОО Альфа", "Дом 1", "01.08.2026", "31.08.2026", "Месячный", "100 000"]])) ;
    expect(result.issues).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ contractNumber: "Д-2026-001", contractDate: "2026-07-15", tenantName: "ТОО Альфа", startDate: "2026-08-01", endDate: "2026-08-31", tariffType: "monthly", tariffAmount: 100000 });
  });
  it("reports invalid tariff rows without dropping valid rows", () => {
    const result = parseContractsExcel(workbookBuffer([["tenantName", "propertyName", "startDate", "endDate", "tariffType", "tariffAmount"], ["Good", "Unit", "2026-08-01", "2026-08-31", "daily", 5000], ["Bad", "Unit", "2026-08-01", "2026-08-31", "monthly", 0]]));
    expect(result.rows).toHaveLength(1);
    expect(result.issues[0]?.row).toBe(3);
  });
  it("fails when required columns are missing", () => {
    const result = parseContractsExcel(workbookBuffer([["Плательщик", "Объект"], ["A", "B"]])); expect(result.rows).toHaveLength(0); expect(result.issues[0]?.message).toContain("Не найдены обязательные колонки");
  });
});

  it("rejects malformed and reversed dates", () => {
    const result = parseContractsExcel(workbookBuffer([["tenantName", "propertyName", "startDate", "endDate", "tariffType", "tariffAmount"], ["Bad date", "Unit", "not-a-date", "2026-08-31", "monthly", 1000], ["Reversed", "Unit", "2026-09-01", "2026-08-31", "daily", 1000]]));
    expect(result.rows).toHaveLength(0);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map(issue => issue.message).join("; ")).toContain("неверная дата"); expect(result.issues.map(issue => issue.message).join("; ")).toContain("начало позже окончания");
  });
  it("parses a legacy sheet using explicit column mapping", () => {
    const result = parseContractsExcel(workbookBuffer([["Клиент", "Локация", "С", "По", "Начисление", "Цена"], ["ТОО Бета", "Корпус 2", "01.08.2026", "31.08.2026", "сутки", "2500"]]), { tenantName: 0, propertyName: 1, startDate: 2, endDate: 3, tariffType: 4, tariffAmount: 5 });
    expect(result.rows[0]).toMatchObject({ tenantName: "ТОО Бета", propertyName: "Корпус 2", tariffType: "daily", tariffAmount: 2500 });
    expect(result.issues).toHaveLength(0);
  });
