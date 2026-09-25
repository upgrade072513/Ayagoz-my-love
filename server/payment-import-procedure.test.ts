import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listInvoices: vi.fn(),
  findPaymentByReference: vi.fn(),
  recordPayment: vi.fn(),
}));

vi.mock("./db", () => ({
  listInvoices: mocks.listInvoices,
  findPaymentByReference: mocks.findPaymentByReference,
  recordPayment: mocks.recordPayment,
  createAccrual: vi.fn(), createContract: vi.fn(), createDocument: vi.fn(), createInvoice: vi.fn(), deleteAccrual: vi.fn(),
  getContract: vi.fn(), getDocument: vi.fn(), getInvoice: vi.fn(), getInvoiceItems: vi.fn(), listAccruals: vi.fn(async () => []), listContracts: vi.fn(async () => []),
  listDocuments: vi.fn(async () => []), listPayments: vi.fn(async () => []), listPaymentAudit: vi.fn(async () => []), markAccrualsInvoiced: vi.fn(), updateAccrual: vi.fn(),
  updateContract: vi.fn(), updateInvoiceEmail: vi.fn(), recalculateInvoicePaymentStatus: vi.fn(), reversePayment: vi.fn(), updateInvoicePaymentStatus: vi.fn(),
  listDepartments: vi.fn(async () => []), listUsers: vi.fn(async () => []), updateUserAccess: vi.fn(), upsertDocumentPermission: vi.fn(), deleteDocumentPermission: vi.fn(),
  createContractAudit: vi.fn(), listContractAudit: vi.fn(), clearDraftAccruals: vi.fn(), deleteContract: vi.fn(),
  createDepartment: vi.fn(),
}));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageRead: vi.fn() }));

import { appRouter } from "./routers";

const caller = (user: any) => appRouter.createCaller({ user, req: {}, res: {} } as any);
const row = (overrides: Record<string, unknown> = {}) => ({ invoiceNumber: "INV-1", amount: 100, paidAt: "2026-08-21", method: "bank" as const, ...overrides });

describe("reconciliation import procedure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listInvoices.mockResolvedValue([{ id: 1, invoiceNumber: "INV-1" }]);
    mocks.findPaymentByReference.mockResolvedValue(undefined);
    mocks.recordPayment.mockResolvedValue({ id: 7, invoiceId: 1, amount: "100.00" });
  });

  it("records a known invoice and reports an unknown invoice without aborting the batch", async () => {
    const result = await caller({ id: 3, role: "manager", departmentId: 1 }).invoices.importPayments({ rows: [row(), row({ invoiceNumber: "UNKNOWN" })] });
    expect(result.imported).toHaveLength(1);
    expect(result.errors).toEqual([{ invoiceNumber: "UNKNOWN", message: "Счёт не найден" }]);
    expect(mocks.recordPayment).toHaveBeenCalledTimes(1);
  });

  it("skips a duplicate transaction reference", async () => {
    mocks.findPaymentByReference.mockResolvedValue({ id: 99 });
    const result = await caller({ id: 1, role: "admin", departmentId: null }).invoices.importPayments({ rows: [row({ reference: "TX-1" })] });
    expect(result.imported).toEqual([]);
    expect(result.errors[0].message).toContain("уже импортирован");
    expect(mocks.recordPayment).not.toHaveBeenCalled();
  });

  it("protects the import from unsupported roles", async () => {
    await expect(caller({ id: 4, role: "legacy", departmentId: 1 }).invoices.importPayments({ rows: [row()] })).rejects.toThrow("Недостаточно прав");
  });
});
