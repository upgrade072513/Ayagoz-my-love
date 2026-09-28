import { describe, expect, it } from "vitest";
import { createLatestPeriodRunner } from "./latestPeriod";

describe("createLatestPeriodRunner", () => {
  it("calls the completion callback only for the latest request", async () => {
    const pending = new Map<string, { resolve: () => void }>();
    const completed: string[] = [];
    const run = createLatestPeriodRunner(
      period => new Promise<void>(resolve => pending.set(period, { resolve }))
    );
    const first = run("2026-07", () => completed.push("2026-07"));
    const second = run("2026-08", () => completed.push("2026-08"));
    pending.get("2026-07")?.resolve();
    await first;
    expect(completed).toEqual([]);
    pending.get("2026-08")?.resolve();
    await second;
    expect(completed).toEqual(["2026-08"]);
  });
});
