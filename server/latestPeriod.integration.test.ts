import { describe, expect, it } from "vitest";
import { createLatestPeriodRunner } from "@shared/latestPeriod";

describe("accrual month switching", () => {
  it("refetches only the latest selected month after an earlier request finishes late", async () => {
    const requests = new Map<string, { resolve: () => void }>();
    const refetched: string[] = [];
    const run = createLatestPeriodRunner((period) => new Promise<void>(resolve => requests.set(period, { resolve })));

    const july = run("2026-07", () => refetched.push("2026-07"));
    const august = run("2026-08", () => refetched.push("2026-08"));

    requests.get("2026-07")?.resolve();
    await july;
    expect(refetched).toEqual([]);

    requests.get("2026-08")?.resolve();
    await august;
    expect(refetched).toEqual(["2026-08"]);
  });
});
