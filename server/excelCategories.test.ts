import { describe, expect, it } from "vitest";
import XLSX from "xlsx-js-style";
import { buildAccrualWorkbook } from "./excelExport";

const contract = (id: number, name: string, folder: string, property: string, unit: string) => ({
  id, contractNumber: `${id}-2026`, tenantName: name, blockFolder: folder, propertyName: property, unitName: unit,
  tariffType: "monthly", tariffAmount: "100000.00", tenantCategory: "c", tenantNumber: "n",
});
const accrual = (id: number, contractId: number) => ({
  id, contractId, period: "2026-08", serviceFrom: new Date("2026-08-01T00:00:00Z"), serviceTo: new Date("2026-08-31T00:00:00Z"),
  amount: "100000.00", status: "draft",
});

describe("Excel report: Family Students and PhD", () => {
  it("one sheet per category, the «Блок» column shows the building", async () => {
    const P = "г. Астана, пр. Кабанбай батыра 53";
    const contracts = [
      contract(1, "Ariza Azam", "Family Students", `${P}, Блок 38`, "101"),
      contract(2, "Family 44", "Family student", `${P}, Блок 44`, "1004"),
      contract(3, "Family 45", "Family Students", `${P}, Блок 45`, "311"),
      contract(4, "PhD 38", "PHD Student", `${P}, Блок 38`, "205"),
    ];
    const result = await buildAccrualWorkbook("2026-08", contracts.map((c, i) => accrual(i + 1, c.id)), contracts);
    const book = XLSX.read(result.buffer, { type: "buffer" });
    expect(book.SheetNames.filter(name => /family/i.test(name))).toEqual(["Family Students"]);
    const family = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Family Students"], { header: 1, raw: true });
    expect(family.slice(3, 6).map(row => [row[4], row[5]])).toEqual([
      ["Ariza Azam", "Блок А1"],
      ["Family 44", "Блок А2"],
      ["Family 45", "Блок А4"],
    ]);
    const phd = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["PHD Student"], { header: 1, raw: true });
    expect(phd[3]?.[5]).toBe("Блок А1");
    const summary = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Сводка по блокам"], { header: 1, raw: true });
    expect(summary.map(row => row?.[0])).toContain("Family Students — Блок А2");
  });
});
