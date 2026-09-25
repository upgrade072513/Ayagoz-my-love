import { describe, expect, it } from "vitest";
import { parseStandaloneRows, parseStandaloneRowsWithErrors } from "./StandaloneAccrualPanel";

describe("PHD_family standalone import", () => {
  it("maps English residency headers and calculates monthly amount from fallback tariff", () => {
    const rows = [
      { Floor: 1, Block: "A3", Apartment: 201, "Name, Surname": " Eriko Dewangga ", "ID number NU": 202497136, "Arrival date": new Date("2026-08-06T00:00:00Z"), "Departure date": "31.12.2026", School: "SEDS", "Type of tenant": "PhD student", "e-mail": "eriko@example.com" },
      { Floor: "", Block: "", Apartment: "", "Name, Surname": "Elijah Aremu", "ID number NU": 202332861, "Arrival date": new Date("2026-08-13T00:00:00Z"), "Departure date": "31.12.2026", School: "SEDS", "Type of tenant": "PhD student", "e-mail": "elijah@example.com" },
    ];
    const result = parseStandaloneRows(rows, "2026-09", { tariffType: "monthly", tariffAmount: 37584 });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ tenantName: "Eriko Dewangga", tenantEmail: "eriko@example.com", propertyName: "Блок A3", unitName: "кв. 201", serviceFrom: "2026-09-01", serviceTo: "2026-09-30", tariffType: "monthly", tariffAmount: 37584, quantity: 1, amount: 37584 });
    expect(result[1]).toMatchObject({ tenantName: "Elijah Aremu", propertyName: "Блок A3", amount: 37584 });
  });

  it("uses daily fallback rate and inclusive arrival/departure days", () => {
    const result = parseStandaloneRows([{ Block: "A3", Apartment: 201, "Name, Surname": "Resident", "Arrival date": "08.09.2026", "Departure date": "10.09.2026", "e-mail": "resident@example.com" }], "2026-09", { tariffType: "daily", tariffAmount: 1200 });
    expect(result[0]).toMatchObject({ quantity: 3, amount: 3600, serviceFrom: "2026-09-08", serviceTo: "2026-09-10", tariffType: "daily" });
  });

  it("keeps valid rows when another row has an invalid email", () => {
    const result = parseStandaloneRowsWithErrors([
      { "Name, Surname": "Valid resident", Block: "A3", Apartment: 201, "e-mail": "valid@example.com" },
      { "Name, Surname": "Resident with typo", Block: "A3", Apartment: 202, "e-mail": "not-an-email" },
    ], "2026-09", { tariffType: "monthly", tariffAmount: 1000 });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].tenantEmail).toBe("valid@example.com");
    expect(result.rows[1].tenantEmail).toBeUndefined();
    expect(result.errors).toEqual(["Строка 3: некорректный Email «not-an-email» — строка загружена без Email"]);
  });

  it("does not silently import a file without tariff or amount", () => {
    expect(() => parseStandaloneRows([{ "Name, Surname": "Resident", Block: "A3", Apartment: 201 }], "2026-09", { tariffType: "monthly", tariffAmount: 0 })).toThrow("Укажите ставку по умолчанию");
  });
});
