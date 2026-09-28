import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  contracts: [] as any[],
  accruals: [] as any[],
}));
const mocks = vi.hoisted(() => ({
  listContracts: vi.fn(async () => state.contracts),
  createContract: vi.fn(async (input: any) => {
    const row = { id: state.contracts.length + 1, ...input };
    state.contracts.push(row);
    return row;
  }),
  listAccruals: vi.fn(async (period?: string) =>
    period
      ? state.accruals.filter(row => row.period === period)
      : state.accruals
  ),
  createAccrual: vi.fn(async (input: any) => {
    const row = { id: state.accruals.length + 1, ...input };
    state.accruals.push(row);
    return row;
  }),
  updateContract: vi.fn(async (id: number, input: any) => {
    const index = state.contracts.findIndex(row => row.id === id);
    if (index < 0) return undefined;
    state.contracts[index] = { ...state.contracts[index], ...input };
    return state.contracts[index];
  }),
  getContract: vi.fn(async (id: number) =>
    state.contracts.find(row => row.id === id)
  ),
  updateAccrual: vi.fn(async (id: number, input: any) => {
    const index = state.accruals.findIndex(row => row.id === id);
    if (index < 0) return undefined;
    state.accruals[index] = { ...state.accruals[index], ...input };
    return state.accruals[index];
  }),
  createContractAudit: vi.fn(),
  listContractAudit: vi.fn(async () => []),
  archiveContract: vi.fn(async (id: number) => ({
    success: true,
    id,
    archived: true,
  })),
  restoreContract: vi.fn(async (id: number) => ({
    success: true,
    id,
    archived: false,
  })),
}));
vi.mock("./db", () => ({
  ...mocks,
  createDocument: vi.fn(),
  createInvoice: vi.fn(),
  getContract: mocks.getContract,
  getInvoiceItems: vi.fn(),
  listDocuments: vi.fn(async () => []),
  createContractAudit: mocks.createContractAudit,
  listContractAudit: mocks.listContractAudit,
  listInvoices: vi.fn(async () => []),
  markAccrualsInvoiced: vi.fn(),
}));

import { appRouter } from "./routers";

const ctx = {
  user: { id: 1, role: "admin", departmentId: null },
  req: {},
  res: {},
} as any;

describe("persisted tariff types and accrual generation", () => {
  it("updates a persisted contract and uses the new tariff in accrual generation", async () => {
    state.contracts.length = 0;
    state.accruals.length = 0;
    const caller = appRouter.createCaller(ctx);
    const contract = await caller.contracts.create({
      tenantName: "До изменения",
      propertyName: "Объект U",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      tariffType: "monthly",
      tariffAmount: 10000,
      status: "ended",
    });
    const updated = await caller.contracts.update({
      id: contract.id,
      tenantName: "После изменения",
      propertyName: "Объект U",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      tariffType: "monthly",
      tariffAmount: 12000,
      status: "ended",
    });
    expect(updated).toMatchObject({
      tenantName: "После изменения",
      tariffType: "monthly",
      tariffAmount: "12000.00",
    });
    const rows = await caller.accruals.generate({ period: "2026-07" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contractId: contract.id,
      amount: "12000.00",
    });
  });

  it("recalculates an existing draft when a contract changes from monthly to daily", async () => {
    state.contracts.length = 0;
    state.accruals.length = 0;
    const caller = appRouter.createCaller(ctx);
    const contract = await caller.contracts.create({
      tenantName: "Переключение тарифа",
      propertyName: "Объект R",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      tariffType: "monthly",
      tariffAmount: 31000,
      status: "ended",
    });
    const monthlyRows = await caller.accruals.generate({ period: "2026-07" });
    expect(monthlyRows[0]).toMatchObject({
      amount: "31000.00",
      quantity: "1.00",
    });
    await caller.contracts.update({
      id: contract.id,
      tenantName: "Переключение тарифа",
      propertyName: "Объект R",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      tariffType: "daily",
      tariffAmount: 5000,
      status: "ended",
    });
    const dailyRows = await caller.accruals.generate({ period: "2026-07" });
    expect(dailyRows[0]).toMatchObject({
      contractId: contract.id,
      amount: "155000.00",
      quantity: "31.00",
    });
    expect(mocks.updateAccrual).toHaveBeenCalledWith(
      monthlyRows[0].id,
      expect.objectContaining({ amount: "155000.00", quantity: "31.00" })
    );
  });

  it("recalculates a partial-month draft after switching from monthly to daily", async () => {
    state.contracts.length = 0;
    state.accruals.length = 0;
    const caller = appRouter.createCaller(ctx);
    const contract = await caller.contracts.create({
      tenantName: "Частичный период",
      propertyName: "Объект P",
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      tariffType: "monthly",
      tariffAmount: 31000,
      status: "ended",
    });
    const monthlyRows = await caller.accruals.generate({ period: "2026-07" });
    expect(monthlyRows[0]).toMatchObject({
      amount: "3000.00",
      quantity: "0.10",
    });
    await caller.contracts.update({
      id: contract.id,
      tenantName: "Частичный период",
      propertyName: "Объект P",
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      tariffType: "daily",
      tariffAmount: 5000,
      status: "ended",
    });
    const dailyRows = await caller.accruals.generate({ period: "2026-07" });
    expect(dailyRows[0]).toMatchObject({
      amount: "15000.00",
      quantity: "3.00",
    });
  });

  it("stops accrual at the actual early termination date", async () => {
    state.contracts.length = 0;
    state.accruals.length = 0;
    const caller = appRouter.createCaller(ctx);
    const contract = await caller.contracts.create({
      tenantName: "Досрочный выезд",
      propertyName: "Объект T",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      terminationDate: "2026-07-12",
      terminationReason: "Досрочный выезд",
      tariffType: "monthly",
      tariffAmount: 31000,
      status: "ended",
    });
    const rows = await caller.accruals.generate({ period: "2026-07" });
    expect(rows[0]).toMatchObject({
      contractId: contract.id,
      amount: "12000.00",
      quantity: "0.39",
    });
  });

  it("allows scheduling an early termination for a future date", async () => {
    state.contracts.length = 0;
    state.accruals.length = 0;
    const caller = appRouter.createCaller(ctx);
    const contract = await caller.contracts.create({
      tenantName: "Планируемый выезд",
      propertyName: "Объект S",
      startDate: "2026-09-01",
      endDate: "2999-12-31",
      terminationDate: "2999-12-30",
      terminationReason: "Плановый досрочный выезд",
      tariffType: "monthly",
      tariffAmount: 31000,
      status: "active",
    });
    expect(contract).toMatchObject({
      terminationDate: expect.any(Date),
      status: "active",
    });
  });

  it("rejects a duplicate contract number before saving", async () => {
    state.contracts.length = 0;
    const caller = appRouter.createCaller(ctx);
    await caller.contracts.create({
      contractNumber: "ДУБ-001",
      contractDate: "2026-01-10",
      tenantName: "Первый",
      propertyName: "Объект",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      tariffType: "monthly",
      tariffAmount: 10000,
      status: "ended",
    });
    await expect(
      caller.contracts.create({
        contractNumber: " дуб-001 ",
        contractDate: "2026-01-11",
        tenantName: "Второй",
        propertyName: "Объект",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        tariffType: "monthly",
        tariffAmount: 10000,
        status: "ended",
      })
    ).rejects.toThrow("уже существует");
    expect(state.contracts).toHaveLength(1);
  });

  it("allows the same contract number only when updating its own record", async () => {
    state.contracts.length = 0;
    const caller = appRouter.createCaller(ctx);
    const contract = await caller.contracts.create({
      contractNumber: "СОБ-001",
      tenantName: "Свой",
      propertyName: "Объект",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      tariffType: "monthly",
      tariffAmount: 10000,
      status: "ended",
    });
    const updated = await caller.contracts.update({
      id: contract.id,
      contractNumber: "СОБ-001",
      tenantName: "Свой изменённый",
      propertyName: "Объект",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      tariffType: "monthly",
      tariffAmount: 10000,
      status: "ended",
    });
    expect(updated).toMatchObject({
      id: contract.id,
      contractNumber: "СОБ-001",
    });
  });

  it("archives and restores a contract through protected procedures", async () => {
    state.contracts.length = 0;
    const caller = appRouter.createCaller(ctx);
    const contract = await caller.contracts.create({
      contractNumber: "УД-001",
      tenantName: "Удаляемый",
      propertyName: "Объект",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      tariffType: "monthly",
      tariffAmount: 10000,
      status: "ended",
    });
    await expect(caller.contracts.delete({ id: contract.id })).resolves.toEqual(
      { success: true, id: contract.id, archived: true }
    );
    expect(mocks.archiveContract).toHaveBeenCalledWith(contract.id);
    await expect(
      caller.contracts.restore({ id: contract.id })
    ).resolves.toEqual({ success: true, id: contract.id, archived: false });
    expect(mocks.restoreContract).toHaveBeenCalledWith(contract.id);
  });

  it("persists monthly and daily contracts and calculates each tariff correctly", async () => {
    state.contracts.length = 0;
    state.accruals.length = 0;
    const caller = appRouter.createCaller(ctx);
    const monthly = await caller.contracts.create({
      tenantName: "Месячный",
      propertyName: "Объект M",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      tariffType: "monthly",
      tariffAmount: 31000,
      status: "ended",
    });
    const daily = await caller.contracts.create({
      tenantName: "Суточный",
      propertyName: "Объект D",
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      tariffType: "daily",
      tariffAmount: 5000,
      status: "ended",
    });
    expect(monthly?.tariffType).toBe("monthly");
    expect(daily?.tariffType).toBe("daily");
    const rows = await caller.accruals.generate({ period: "2026-07" });
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.contractId === monthly.id)).toMatchObject({
      amount: "31000.00",
      quantity: "1.00",
    });
    expect(rows.find(row => row.contractId === daily.id)).toMatchObject({
      amount: "15000.00",
      quantity: "3.00",
    });
  });
});
