import { describe, expect, it, vi } from "vitest";
import XLSX from "xlsx-js-style"; // tests only: builds fixture workbooks

const mocks = vi.hoisted(() => ({
  createContract: vi.fn(async (input: any) => ({ id: 101, ...input })),
}));
vi.mock("./db", () => ({
  createContract: mocks.createContract,
  listContracts: vi.fn(async () => []),
  listAccruals: vi.fn(async () => []),
  createAccrual: vi.fn(),
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

function dataUrl() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Клиент", "Локация", "С", "По", "Начисление", "Цена"],
    ["ТОО Бета", "Корпус 2", "01.09.2026", "30.09.2026", "сутки", "2500"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Legacy");
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString("base64")}`;
}

describe("Excel import procedures", () => {
  it("previews and confirms a custom-mapped legacy workbook", async () => {
    const ctx = { user: { id: 1, role: "admin" }, req: {}, res: {} } as any;
    const caller = appRouter.createCaller(ctx);
    const preview = await caller.contracts.previewImport({
      dataUrl: dataUrl(),
      mapping: {
        tenantName: 0,
        propertyName: 1,
        startDate: 2,
        endDate: 3,
        tariffType: 4,
        tariffAmount: 5,
      },
    });
    expect(preview.rows).toHaveLength(1);
    const imported = await caller.contracts.importRows({ rows: preview.rows });
    expect(imported).toHaveLength(1);
    expect(mocks.createContract).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantName: "ТОО Бета",
        tariffType: "daily",
        tariffAmount: "2500.00",
      })
    );
  });
});
