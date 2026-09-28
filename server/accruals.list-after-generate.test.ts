import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as any[] }));
const mocks = vi.hoisted(() => ({
  listContracts: vi.fn(async () => [
    {
      id: 1,
      tenantName: "Реальный договор",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-31T00:00:00.000Z"),
      tariffType: "monthly",
      tariffAmount: "31000.00",
      status: "ended",
    },
  ]),
  listAccruals: vi.fn(async (period?: string) =>
    period ? state.rows.filter(row => row.period === period) : state.rows
  ),
  createAccrual: vi.fn(async (input: any) => {
    const row = { id: state.rows.length + 1, ...input };
    state.rows.push(row);
    return row;
  }),
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

describe("accruals generate then list", () => {
  it("returns generated rows from the selected period list", async () => {
    state.rows.length = 0;
    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: {},
      res: {},
    } as any);
    await caller.accruals.generate({ period: "2026-07" });
    const listed = await caller.accruals.list({ period: "2026-07" });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      contractId: 1,
      period: "2026-07",
      amount: "31000.00",
    });
  });
});
