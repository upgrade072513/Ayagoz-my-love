import { describe, expect, it } from "vitest";
import { findDuplicateContracts } from "@shared/nameMatch";

const c = (id: number, contractNumber: string | null, tenantName: string, startDate: string, endDate: string) => ({ id, contractNumber, tenantName, startDate, endDate });

describe("possible duplicate contracts", () => {
  it("same number twice, or the same person with overlapping periods", () => {
    const found = findDuplicateContracts([
      c(1, "0502-2026/08-23", "Акмарал Балпышева", "2026-08-07", "2027-07-31"),
      c(2, "502-2026", "Балпышева Акмарал", "2026-08-07", "2027-07-31"), // imported from Excel + scan
      c(3, "255-2026", "Жасұлан Төлеубек", "2026-01-05", "2026-07-31"),
      c(4, "415-2026", "Zhassulan Toleubek", "2026-08-01", "2027-07-31"), // next year's contract — not a duplicate
      c(5, "600-2026", "Nancy Lee Stitt", "2026-08-30", "2026-10-13"),
      c(6, "601-2026", "Mr. Nancy L Stitt", "2026-09-01", "2026-12-31"),
      c(7, "700-2026", "Иванов Иван", "2026-01-01", "2026-12-31"),
    ]);
    expect(Array.from(found.keys()).sort()).toEqual([1, 2, 5, 6]);
    expect(Array.from(found.get(1)!).join(" ")).toMatch(/тот же номер/);
    expect(Array.from(found.get(5)!).join(" ")).toMatch(/периоды пересекаются/);
  });
});
