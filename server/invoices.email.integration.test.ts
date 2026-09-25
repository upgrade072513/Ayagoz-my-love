import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInvoice: vi.fn(async () => ({ id: 20, invoiceNumber: "INV-1", period: "2026-08", tenantName: "Иван Иванов", totalAmount: "116000.00", emailStatus: "pending" })),
  getInvoiceItems: vi.fn(async () => [{ id: 30, invoiceId: 20, accrualId: 10, description: "Услуги проживания 2026-08-01 — 2026-08-31", amount: "116000.00" }]),
  listAccruals: vi.fn(async () => [{ id: 10, contractId: 7, period: "2026-08" }]),
  listContracts: vi.fn(async () => [{ id: 7, tenantEmail: "buyer@example.com" }]),
  updateInvoiceEmail: vi.fn(async (id: number, input: any) => ({ id, emailStatus: input.emailStatus, emailSentAt: input.emailSentAt ?? null, emailError: input.emailError ?? null })),
  buildInvoiceEmail: vi.fn(() => ({ subject: "Счёт INV-1", html: "<p>preview</p>", text: "preview", dueDate: "2026-08-10", dueDateLabel: "10 августа 2026 года" })),
}));

vi.mock("./email", () => ({ buildInvoiceEmail: mocks.buildInvoiceEmail }));
vi.mock("./db", () => ({
  ...mocks,
  createAccrual: vi.fn(),
  createContract: vi.fn(),
  createDocument: vi.fn(),
  createInvoice: vi.fn(),
  getContract: vi.fn(),
  getInvoiceItems: mocks.getInvoiceItems,
  listDocuments: vi.fn(async () => []),
  listInvoices: vi.fn(async () => []),
  markAccrualsInvoiced: vi.fn(),
  updateAccrual: vi.fn(),
  updateContract: vi.fn(),
}));

import { appRouter } from "./routers";

const caller = () => appRouter.createCaller({ user: { id: 1, role: "admin" }, req: {}, res: {} } as any);

describe("invoice email via the user's mail app", () => {
  beforeEach(() => {
    mocks.updateInvoiceEmail.mockClear();
    mocks.listContracts.mockResolvedValue([{ id: 7, tenantEmail: "buyer@example.com" }] as any);
  });

  it("previews recipient, due date, subject, and rendered email content", async () => {
    const result = await caller().invoices.previewEmail({ invoiceId: 20 });
    expect(result).toMatchObject({ recipient: "buyer@example.com", dueDate: "2026-08-10", dueDateLabel: "10 августа 2026 года", subject: "Счёт INV-1", html: "<p>preview</p>", text: "preview", warnings: [] });
    expect(mocks.buildInvoiceEmail).toHaveBeenCalledWith(expect.objectContaining({ recipient: "buyer@example.com", period: "2026-08" }));
  });

  it("previews a warning instead of inventing a recipient when Email is missing", async () => {
    mocks.listContracts.mockResolvedValueOnce([{ id: 7, tenantEmail: null }] as any);
    const result = await caller().invoices.previewEmail({ invoiceId: 20 });
    expect(result.recipient).toBeNull();
    expect(result.warnings).toContain("У плательщика не указан Email в договоре");
  });

  it("marks the invoice as sent to the contract Email", async () => {
    const result = await caller().invoices.markEmailSent({ invoiceId: 20 });
    expect(result).toMatchObject({ recipient: "buyer@example.com", invoice: { emailStatus: "sent" } });
    expect(mocks.updateInvoiceEmail).toHaveBeenCalledWith(20, expect.objectContaining({ emailStatus: "sent", emailError: null }));
  });

  it("refuses to mark as sent when the contract has no Email", async () => {
    mocks.listContracts.mockResolvedValueOnce([{ id: 7, tenantEmail: null }] as any);
    await expect(caller().invoices.markEmailSent({ invoiceId: 20 })).rejects.toThrow("У плательщика не указан Email");
    expect(mocks.updateInvoiceEmail).not.toHaveBeenCalled();
  });
});
