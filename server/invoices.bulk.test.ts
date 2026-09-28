import { describe, expect, it, vi } from "vitest";
import XLSX from "xlsx-js-style"; // tests only: builds/reads fixture workbooks

const mocks = vi.hoisted(() => ({
  listAccruals: vi.fn(async () => [
    {
      id: 1,
      contractId: 11,
      period: "2026-07",
      serviceFrom: new Date("2026-07-01T00:00:00Z"),
      serviceTo: new Date("2026-07-31T00:00:00Z"),
      quantity: "1.00",
      amount: "37584.00",
      status: "draft",
    },
    {
      id: 2,
      contractId: 12,
      period: "2026-07",
      serviceFrom: new Date("2026-07-01T00:00:00Z"),
      serviceTo: new Date("2026-07-31T00:00:00Z"),
      quantity: "1.00",
      amount: "41000.00",
      status: "draft",
    },
    {
      id: 3,
      contractId: 13,
      period: "2026-07",
      serviceFrom: new Date("2026-07-15T00:00:00Z"),
      serviceTo: new Date("2026-07-31T00:00:00Z"),
      quantity: "17.00",
      amount: "17000.00",
      status: "invoiced",
    },
  ]),
  listContracts: vi.fn(async () => [
    {
      id: 11,
      contractNumber: "Д-2026-001",
      contractDate: new Date("2026-07-15T00:00:00Z"),
      tenantName: "Плательщик 1",
      tenantCategory: "Сотрудник",
      tenantNumber: "Ж-001",
      propertyName: "Блок 1",
      blockFolder: "Блок А1",
      unitName: "101",
    },
    {
      id: 12,
      tenantName: "Плательщик 2",
      tenantCategory: "Гость",
      tenantNumber: "Ж-002",
      propertyName: "Блок 2",
      blockFolder: "Блок А2",
      unitName: "202",
    },
    {
      id: 13,
      tenantName: "Плательщик 3",
      tenantCategory: "Подрядчик",
      tenantNumber: "Ж-003",
      propertyName: "Блок 3",
      blockFolder: "ХВ Астана",
      unitName: "303",
    },
  ]),
  getContract: vi.fn(async (id: number) => ({
    id,
    tenantName: `Плательщик ${id - 10}`,
  })),
  createInvoice: vi.fn(async (input: any) => ({
    id: 100 + mocks.createInvoice.mock.calls.length,
    ...input,
  })),
  markAccrualsInvoiced: vi.fn(async () => undefined),
  clearDraftAccruals: vi.fn(async (period?: string) => ({
    deleted: period ? 2 : 3,
    skipped: 1,
    requested: period ? 3 : 4,
  })),
  updateAccrual: vi.fn(async (id: number, input: any) => ({ id, ...input })),
  updateDraftAccrual: vi.fn(async (id: number, input: any) => ({
    id,
    ...input,
  })),
  deleteAccrual: vi.fn(async (id: number) => ({ id })),
  getAccrual: vi.fn(async (id: number) =>
    (await mocks.listAccruals()).find((row: any) => row.id === id)
  ),
}));
vi.mock("./db", () => ({
  ...mocks,
  AccrualsAlreadyInvoicedError: class extends Error {},
  createAccrual: vi.fn(),
  createContract: vi.fn(),
  createDocument: vi.fn(),
  getInvoiceItems: vi.fn(),
  listDocuments: vi.fn(async () => []),
  listInvoices: vi.fn(async () => []),
  updateContract: vi.fn(),
}));

import { appRouter } from "./routers";

describe("accruals.clearHistory", () => {
  it("delegates to the protected cleanup helper for the selected period", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: {},
      res: {},
    } as any);
    const result = await caller.accruals.clearHistory({ period: "2026-07" });
    expect(result).toEqual({ deleted: 2, skipped: 1, requested: 3 });
    expect(mocks.clearDraftAccruals).toHaveBeenCalledWith("2026-07");
  });
});

describe("invoices.bulkCreate", () => {
  it("creates one invoice per draft tenant and marks only draft rows invoiced", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: {},
      res: {},
    } as any);
    const result = await caller.invoices.bulkCreate({ period: "2026-07" });
    expect(result.created).toHaveLength(2);
    expect(result.created.map(invoice => invoice.tenantName)).toEqual([
      "Плательщик 1",
      "Плательщик 2",
    ]);
    // Accruals are switched to "invoiced" inside createInvoice's transaction (atomic).
    expect(mocks.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ tenantName: "Плательщик 1" }),
      [expect.objectContaining({ accrualId: 1 })]
    );
    expect(mocks.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ tenantName: "Плательщик 2" }),
      [expect.objectContaining({ accrualId: 2 })]
    );
  });
});

describe("accruals.updateFromPreview", () => {
  it("persists corrected fields from the preview editor", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: {},
      res: {},
    } as any);
    await caller.accruals.updateFromPreview({
      id: 1,
      contractId: 11,
      tenantName: "Исправленный плательщик",
      amount: 1250.5,
      serviceFrom: "2026-07-01",
      serviceTo: "2026-07-31",
    });
    expect(mocks.updateDraftAccrual).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        contractId: 11,
        tenantName: "Исправленный плательщик",
        amount: "1250.50",
        amountEdited: true,
      })
    );
  });
});

describe("accruals.removeMany", () => {
  it("deletes selected draft rows and rejects invoiced rows", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: {},
      res: {},
    } as any);
    await expect(caller.accruals.removeMany({ ids: [1, 2] })).resolves.toEqual({
      deleted: 2,
    });
    await expect(caller.accruals.removeMany({ ids: [3] })).rejects.toThrow(
      "Начисление в счёте нельзя удалить"
    );
  });
});

describe("invoices.exportExcel", () => {
  it("returns a valid workbook with the selected period rows", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: {},
      res: {},
    } as any);
    const result = await caller.invoices.exportExcel({ period: "2026-07" });
    const workbook = XLSX.read(Buffer.from(result.dataBase64, "base64"), {
      type: "buffer",
    });
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets["Начисления"],
      { header: 1, raw: true, blankrows: true }
    );
    expect(result.fileName).toBe("Услуги проживания (физ лица)-2026-07.xlsx");
    expect(result.count).toBe(3);
    expect(result.vatRate).toBe(0.16);
    expect(matrix[0]?.[0]).toBe("Услуги проживания (физ лица) - 2026-07");
    expect(matrix[2]).toEqual([
      "№",
      "Номер договора",
      "Дата договора",
      "Фактическая дата расторжения",
      "ФИО",
      "Блок",
      "Жилое помещение",
      "Тариф",
      "Вид тарифа",
      "Месяц расчета",
      "Начала расчетного периода",
      "Конец расчетного периода",
      "Количество дней",
      "Сумма отчета за период (с учетом НДС) в тенге",
      "Сумма отчета за период (без НДС) в тенге",
    ]);
    expect(matrix[3]).toEqual([
      1,
      "Д-2026-001",
      "2026-07-15",
      undefined,
      "Плательщик 1",
      "Блок А1",
      "101",
      0,
      "Месячный",
      "2026-07",
      "2026-07-01",
      "2026-07-31",
      31,
      37584,
      32400,
    ]);
    const totalRow = matrix[matrix.length - 1] ?? [];
    expect(totalRow[0]).toBe("ИТОГО за расчетный период");
    expect(totalRow[13]).toBe(95584);
    expect(totalRow[14]).toBe(82400);
    expect(workbook.SheetNames).toContain("Ошибки");
    expect(workbook.SheetNames).toEqual([
      "Сводка по блокам",
      "Начисления",
      "Блок А1",
      "Блок А2",
      "ХВ Астана",
      "Ошибки",
    ]);
    expect(
      XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Блок А1"], {
        header: 1,
        raw: true,
        blankrows: true,
      })[3]?.[4]
    ).toBe("Плательщик 1");
  });

  it("exports only accruals from the selected block folder", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: {},
      res: {},
    } as any);
    const result = await caller.invoices.exportExcel({
      period: "2026-07",
      blockFolder: "Блок А1",
    });
    expect(result.count).toBe(1);
    expect(result.fileName).toBe(
      "Услуги проживания (физ лица)-2026-07-Блок А1.xlsx"
    );
  });
  it("returns validation summary before export", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, role: "admin" },
      req: {},
      res: {},
    } as any);
    const result = await caller.invoices.previewExcel({ period: "2026-07" });
    expect(result.totalRows).toBe(3);
    expect(result.errorCount).toBe(0);
    expect(result.totalAmount).toBe(95584);
  });
});
