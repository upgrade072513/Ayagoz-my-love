import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateInvoicePaymentStatus: vi.fn(
    async (id: number, status: string, actorId: number) => ({
      id,
      paymentStatus: status,
      actorId,
    })
  ),
  reversePayment: vi.fn(
    async (paymentId: number, actorId: number, note?: string) => ({
      paymentId,
      actorId,
      note,
    })
  ),
  recordPayment: vi.fn(async (input: any, actorId: number) => ({
    id: 88,
    ...input,
    actorId,
  })),
  listPaymentAudit: vi.fn(async (invoiceId: number) => [
    { invoiceId, action: "recorded" },
  ]),
  // Invoice 42 bills accrual 5 of contract 3 in "Блок А1"; payment 77 belongs to invoice 42.
  getInvoice: vi.fn(async (id: number) =>
    id === 42
      ? { id: 42, invoiceNumber: "INV-42", period: "2026-08" }
      : undefined
  ),
  getInvoiceItems: vi.fn(async (id: number) =>
    id === 42 ? [{ id: 1, invoiceId: 42, accrualId: 5, amount: "100.00" }] : []
  ),
  listAccrualsByIds: vi.fn(async (ids: number[]) =>
    ids.includes(5) ? [{ id: 5, contractId: 3, status: "invoiced" }] : []
  ),
  listContracts: vi.fn(async () => [
    { id: 3, blockFolder: "Блок А1", propertyName: "Блок 38" },
  ]),
  getPayment: vi.fn(async (id: number) =>
    id === 77 ? { id: 77, invoiceId: 42, status: "posted" } : undefined
  ),
}));

vi.mock("./db", () => ({
  updateInvoicePaymentStatus: mocks.updateInvoicePaymentStatus,
  reversePayment: mocks.reversePayment,
  recordPayment: mocks.recordPayment,
  listPaymentAudit: mocks.listPaymentAudit,
  createAccrual: vi.fn(),
  createContract: vi.fn(),
  createDocument: vi.fn(),
  createInvoice: vi.fn(),
  getContract: vi.fn(),
  getInvoice: mocks.getInvoice,
  getInvoiceItems: mocks.getInvoiceItems,
  listAccrualsByIds: mocks.listAccrualsByIds,
  getPayment: mocks.getPayment,
  listAccruals: vi.fn(async () => []),
  listContracts: mocks.listContracts,
  listDocuments: vi.fn(async () => []),
  listInvoices: vi.fn(async () => []),
  markAccrualsInvoiced: vi.fn(),
  updateAccrual: vi.fn(),
  updateContract: vi.fn(),
  updateInvoiceEmail: vi.fn(),
  listPayments: vi.fn(async () => []),
  recalculateInvoicePaymentStatus: vi.fn(),
  listDepartments: vi.fn(async () => []),
  listUsers: vi.fn(async () => []),
  updateUserAccess: vi.fn(),
  listDocumentPermissions: vi.fn(async () => []),
  upsertDocumentPermission: vi.fn(),
  deleteDocumentPermission: vi.fn(),
  createContractAudit: vi.fn(),
  listContractAudit: vi.fn(),
}));

import { appRouter } from "./routers";

// Managers here are assigned to the invoice's block.
const caller = (user?: any) =>
  appRouter.createCaller({
    user: user && { managedBlocks: JSON.stringify(["Блок А1"]), ...user },
    req: {},
    res: {},
  } as any);

describe("invoices.updatePaymentStatus", () => {
  it("persists an allowed status and passes the actor for audit", async () => {
    const result = await caller({
      id: 7,
      role: "manager",
    }).invoices.updatePaymentStatus({
      invoiceId: 42,
      paymentStatus: "overdue",
    });
    expect(result).toMatchObject({ id: 42, paymentStatus: "overdue" });
    expect(mocks.updateInvoicePaymentStatus).toHaveBeenCalledWith(
      42,
      "overdue",
      7,
      undefined
    );
  });

  it("rejects anonymous status changes", async () => {
    await expect(
      caller().invoices.updatePaymentStatus({
        invoiceId: 42,
        paymentStatus: "paid",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("reverses a payment with the authenticated actor", async () => {
    const result = await caller({
      id: 9,
      role: "manager",
    }).invoices.reversePayment({
      paymentId: 77,
      note: "Исправление банковской выписки",
    });
    expect(result).toEqual({
      paymentId: 77,
      actorId: 9,
      note: "Исправление банковской выписки",
    });
    expect(mocks.reversePayment).toHaveBeenCalledWith(
      77,
      9,
      "Исправление банковской выписки"
    );
  });

  it("records a payment with the authenticated actor and normalized amount", async () => {
    const result = await caller({
      id: 12,
      role: "manager",
    }).invoices.recordPayment({
      invoiceId: 42,
      amount: 125.5,
      paidAt: "2026-08-21",
      method: "bank",
      reference: "TX-1",
    });
    expect(result).toMatchObject({
      id: 88,
      invoiceId: 42,
      amount: "125.50",
      actorId: 12,
    });
    expect(mocks.recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 42,
        amount: "125.50",
        method: "bank",
        reference: "TX-1",
        paidAt: expect.any(Date),
      }),
      12
    );
  });

  it("returns protected payment audit history", async () => {
    await expect(
      caller({ id: 12, role: "manager" }).invoices.paymentAudit({
        invoiceId: 42,
      })
    ).resolves.toEqual([{ invoiceId: 42, action: "recorded" }]);
    expect(mocks.listPaymentAudit).toHaveBeenCalledWith(42);
  });

  it("rejects anonymous payment reversal", async () => {
    await expect(
      caller().invoices.reversePayment({ paymentId: 77 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
