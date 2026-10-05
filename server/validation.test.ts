import { describe, expect, it } from "vitest";
import { contractInput } from "./routers";

// Always in the future: an «active» contract may not have ended already.
const nextYear = new Date().getUTCFullYear() + 1;
const base = {
  tenantName: "ТОО Альфа",
  propertyName: "Объект 1",
  startDate: `${nextYear}-09-01`,
  endDate: `${nextYear}-09-30`,
  tariffType: "monthly" as const,
  tariffAmount: 100000,
  status: "active" as const,
};

describe("contractInput", () => {
  it("accepts a valid active contract", () => {
    expect(contractInput.safeParse(base).success).toBe(true);
  });
  it("rejects a reversed contract period", () => {
    const result = contractInput.safeParse({
      ...base,
      startDate: "2026-09-01",
      endDate: "2026-08-31",
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.some(issue => issue.message.includes("позже"))
      ).toBe(true);
  });
  it("rejects an active contract that already ended", () => {
    const result = contractInput.safeParse({
      ...base,
      startDate: "2020-01-01",
      endDate: "2020-01-31",
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.some(issue => issue.message.includes("завершённый"))
      ).toBe(true);
  });
  it("accepts daily tariffs and rejects unsupported tariff types", () => {
    expect(
      contractInput.safeParse({ ...base, tariffType: "daily" }).success
    ).toBe(true);
    expect(
      contractInput.safeParse({ ...base, tariffType: "weekly" }).success
    ).toBe(false);
  });
});
