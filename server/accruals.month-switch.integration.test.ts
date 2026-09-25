import { describe, expect, it, vi } from "vitest";
import { createLatestPeriodRunner } from "@shared/latestPeriod";

const mocks = vi.hoisted(() => ({
  listContracts: vi.fn(async () => [{ id: 1, tenantName: "Арендатор", startDate: "2026-01-01", endDate: "2026-12-31", tariffType: "monthly", tariffAmount: "1000.00", status: "active" }]),
  listAccruals: vi.fn(async () => []),
  createAccrual: vi.fn(async (input: any) => ({ id: 1, ...input })),
}));
vi.mock("./db", () => ({ ...mocks, createContract: vi.fn(), createDocument: vi.fn(), createInvoice: vi.fn(), getContract: vi.fn(), getInvoiceItems: vi.fn(), listDocuments: vi.fn(async () => []), listInvoices: vi.fn(async () => []), markAccrualsInvoiced: vi.fn(), updateContract: vi.fn() }));

import { appRouter } from "./routers";

type Gate = { promise: Promise<void>; resolve: () => void };
const gate = (): Gate => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe("real accrual month-switch orchestration", () => {
  it("generates through the router and refetches only the latest selected month", async () => {
    const caller = appRouter.createCaller({ user: { id: 1, role: "admin" }, req: {}, res: {} } as any);
    const july = gate();
    const august = gate();
    const refetched: string[] = [];
    const runner = createLatestPeriodRunner(async period => { const requestGate = period === "2026-07" ? july : august; await requestGate.promise; return caller.accruals.generate({ period }); });

    const julyRequest = runner("2026-07", () => refetched.push("2026-07"));
    const augustRequest = runner("2026-08", () => refetched.push("2026-08"));
    july.resolve();
    await julyRequest;
    expect(mocks.createAccrual).toHaveBeenCalledWith(expect.objectContaining({ period: "2026-07" }));
    expect(refetched).toEqual([]);
    august.resolve();
    await augustRequest;
    expect(mocks.createAccrual).toHaveBeenCalledWith(expect.objectContaining({ period: "2026-08" }));
    expect(refetched).toEqual(["2026-08"]);
  });
});
