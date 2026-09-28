import { describe, expect, it } from "vitest";
import { calculateAccrual } from "@shared/accrual";

describe("calculateAccrual", () => {
  it("charges a full monthly tariff for a full month", () => {
    expect(
      calculateAccrual(
        {
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          tariffType: "monthly",
          tariffAmount: 100000,
        },
        "2026-01"
      )
    ).toMatchObject({ quantity: 1, amount: 100000 });
  });
  it("pro-rates a monthly tariff for a partial month", () => {
    expect(
      calculateAccrual(
        {
          startDate: "2026-01-16",
          endDate: "2026-01-31",
          tariffType: "monthly",
          tariffAmount: 100000,
        },
        "2026-01"
      )
    ).toMatchObject({ quantity: 0.52, amount: 51612.9 });
  });
  it("charges daily tariffs by inclusive active days", () => {
    expect(
      calculateAccrual(
        {
          startDate: "2026-02-10",
          endDate: "2026-02-12",
          tariffType: "daily",
          tariffAmount: 5000,
        },
        "2026-02"
      )
    ).toMatchObject({ quantity: 3, amount: 15000 });
  });
  it("returns null when the contract is outside the selected month", () => {
    expect(
      calculateAccrual(
        {
          startDate: "2026-03-01",
          endDate: "2026-03-31",
          tariffType: "daily",
          tariffAmount: 5000,
        },
        "2026-02"
      )
    ).toBeNull();
  });
});
