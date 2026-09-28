import { describe, expect, it } from "vitest";
import {
  getContractEffectiveEndDate,
  shouldAutoArchiveContract,
} from "@shared/contractLifecycle";

describe("contract lifecycle", () => {
  it("uses early termination as the effective end date", () => {
    expect(
      getContractEffectiveEndDate({
        endDate: "2026-09-30",
        terminationDate: "2026-09-12",
      })
    ).toBe("2026-09-12");
    expect(
      shouldAutoArchiveContract(
        { endDate: "2026-09-30", terminationDate: "2026-09-12" },
        "2026-09-13"
      )
    ).toBe(true);
  });

  it("archives on the contractual end date and does not re-archive history", () => {
    expect(
      shouldAutoArchiveContract(
        { endDate: new Date("2026-09-30T00:00:00Z") },
        "2026-09-30"
      )
    ).toBe(true);
    expect(
      shouldAutoArchiveContract(
        { endDate: "2026-09-01", archivedAt: new Date() },
        "2026-09-30"
      )
    ).toBe(false);
  });
});
