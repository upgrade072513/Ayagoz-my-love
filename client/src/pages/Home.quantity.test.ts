import { describe, expect, it } from "vitest";
import { calculationQuantityLabel, countRentersByBlock, hasLessThanMonthRemaining, shouldReviewOcrField, parseContractIdentityFromFileName } from "./Home";

describe("parseContractIdentityFromFileName", () => {
  it("extracts number and Russian date from the uploaded filename", () => {
    expect(parseContractIdentityFromFileName("0353-2026-08-23 от 04.08.2026. Paula Dupury.pdf")).toEqual({ contractNumber: "0353-2026-08-23", contractDate: "2026-08-04" });
  });

  it("extracts a number without inventing a date when the filename has no date", () => {
    expect(parseContractIdentityFromFileName("№ D-17 scan.png")).toEqual({ contractNumber: "D-17", contractDate: null });
  });
});

describe("countRentersByBlock", () => {
  it("counts unique renters per block using email when available", () => {
    expect(countRentersByBlock([{ propertyName: "A1", tenantName: "Иванов", tenantEmail: "ivan@example.com" }, { propertyName: "A1", tenantName: "Иванов", tenantEmail: "IVAN@example.com" }, { propertyName: "A1", tenantName: "Петров", tenantEmail: "petr@example.com" }, { propertyName: "B2", tenantName: "Сидоров" }])).toEqual([{ block: "A1", renters: 2 }, { block: "B2", renters: 1 }]);
  });
});

describe("calculationQuantityLabel", () => {
  it("shows daily tariff as a number of days", () => {
    expect(calculationQuantityLabel({ period: "2026-07", serviceFrom: "2026-07-01", serviceTo: "2026-07-15" }, { tariffType: "daily" })).toBe("15 дней");
  });

  it("shows a full monthly period as one month", () => {
    expect(calculationQuantityLabel({ period: "2026-07", serviceFrom: "2026-07-01", serviceTo: "2026-07-31" }, { tariffType: "monthly" })).toBe("1 месяц");
  });

  it("shows a partial monthly period as days out of one month", () => {
    expect(calculationQuantityLabel({ period: "2026-08", serviceFrom: "2026-08-15", serviceTo: "2026-08-31" }, { tariffType: "monthly" })).toBe("17 дней / 1 месяц");
  });
});

describe("contract review helpers", () => {
  it("flags contracts ending today or within one calendar month", () => {
    const now = new Date("2026-08-28T12:00:00Z");
    expect(hasLessThanMonthRemaining("2026-08-28", now)).toBe(true);
    expect(hasLessThanMonthRemaining("2026-09-27", now)).toBe(true);
    expect(hasLessThanMonthRemaining("2026-09-28", now)).toBe(false);
    expect(hasLessThanMonthRemaining("2026-10-01", now)).toBe(false);
  });

  it("flags empty or low-confidence OCR fields for review", () => {
    expect(shouldReviewOcrField("", 0.95)).toBe(true);
    expect(shouldReviewOcrField("Найдено", 0.74)).toBe(true);
    expect(shouldReviewOcrField("Найдено", 0.95)).toBe(false);
  });
});
