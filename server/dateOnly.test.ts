import { describe, expect, it } from "vitest";
import { toDateOnly } from "@shared/dateOnly";

describe("toDateOnly", () => {
  it("normalizes database Date values without losing the calendar day", () => {
    expect(toDateOnly(new Date("2026-07-01T00:00:00.000Z"))).toBe("2026-07-01");
  });

  it("keeps ISO date strings and rejects invalid values", () => {
    expect(toDateOnly("2026-08-31")).toBe("2026-08-31");
    expect(() => toDateOnly("not-a-date")).toThrow("Некорректная дата договора");
  });
});
