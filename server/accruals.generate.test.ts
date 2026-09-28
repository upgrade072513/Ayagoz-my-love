import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listContracts: vi.fn(async () => [
    {
      id: 1,
      tenantName: "Исторический договор",
      startDate: new Date("2026-02-01T00:00:00.000Z"),
      endDate: new Date("2026-07-31T00:00:00.000Z"),
      tariffType: "monthly",
      tariffAmount: "37584.00",
      status: "ended",
    },
    {
      id: 2,
      tenantName: "Пауза",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      tariffType: "monthly",
      tariffAmount: "1000.00",
      status: "paused",
    },
  ]),
  listAccruals: vi.fn(async () => []),
  createAccrual: vi.fn(async (input: any) => ({ id: 10, ...input })),
}));
vi.mock("./db", () => ({
  ...mocks,
  createContract: vi.fn(),
  createDocument: vi.fn(),
  createInvoice: vi.fn(),
  getContract: vi.fn(),
  getInvoiceItems: vi.fn(),
  listDocuments: vi.fn(async () => []),
  listInvoices: vi.fn(async () => []),
  markAccrualsInvoiced: vi.fn(),
  updateContract: vi.fn(),
}));

import { appRouter } from "./routers";

describe("accruals.generate", () => {
  it("includes ended contracts that overlap a historical period and excludes paused contracts", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: {},
      res: {},
    } as any);
    const result = await caller.accruals.generate({ period: "2026-07" });
    expect(mocks.listContracts).toHaveBeenCalledWith(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      contractId: 1,
      serviceFrom: new Date("2026-07-01T00:00:00Z"),
      serviceTo: new Date("2026-07-31T00:00:00Z"),
      amount: "37584.00",
    });
    expect(mocks.createAccrual).toHaveBeenCalledTimes(1);
  });
});
