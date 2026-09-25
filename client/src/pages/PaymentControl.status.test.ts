import { describe, expect, it } from "vitest";
import { PAYMENT_STATUS_OPTIONS, calculateOverdueOutstanding, filterOverdueInvoices, filterPaymentInvoices, paymentStatusTone } from "./PaymentControl";

describe("payment status presentation", () => {
  it("supports all invoice payment statuses", () => {
    expect(PAYMENT_STATUS_OPTIONS).toEqual(["issued", "partially_paid", "paid", "overdue", "disputed", "cancelled"]);
  });

  it("uses distinct semantic tones for key statuses", () => {
    expect(paymentStatusTone("paid")).toContain("emerald");
    expect(paymentStatusTone("overdue")).toContain("red");
    expect(paymentStatusTone("disputed")).toContain("orange");
  });

  it("calculates overdue outstanding balance after partial payments", () => {
    const invoices = [{ id: 1, paymentStatus: "overdue", totalAmount: "1000" }, { id: 2, paymentStatus: "paid", totalAmount: "500" }, { id: 3, paymentStatus: "overdue", totalAmount: "300" }];
    const payments = [{ invoiceId: 1, status: "posted", amount: "250" }, { invoiceId: 3, status: "posted", amount: "400" }];
    expect(calculateOverdueOutstanding(invoices, payments)).toBe(750);
  });

  it("counts the full overdue invoice when there are no payments", () => {
    expect(calculateOverdueOutstanding([{ id: 10, paymentStatus: "overdue", totalAmount: "1250" }], [])).toBe(1250);
  });

  it("returns zero when posted payments fully cover an overdue invoice", () => {
    expect(calculateOverdueOutstanding([{ id: 11, paymentStatus: "overdue", totalAmount: "1250" }], [{ invoiceId: 11, status: "posted", amount: "1250" }])).toBe(0);
  });

  it("filters only overdue invoices and respects unsaved status drafts", () => {
    const invoices = [{ id: 1, paymentStatus: "issued" }, { id: 2, paymentStatus: "overdue" }, { id: 3, paymentStatus: "paid" }];
    expect(filterOverdueInvoices(invoices, true, { 1: "overdue" }).map(invoice => invoice.id)).toEqual([1, 2]);
    expect(filterOverdueInvoices(invoices, false, {}).map(invoice => invoice.id)).toEqual([1, 2, 3]);
  });

  it("filters by status, due date, payer, and period together", () => {
    const invoices = [
      { id: 1, paymentStatus: "issued", dueDate: "2026-09-10T00:00:00.000Z", tenantName: "Анна Ким", period: "2026-09" },
      { id: 2, paymentStatus: "overdue", dueDate: "2026-08-10T00:00:00.000Z", tenantName: "Борис Петров", period: "2026-08" },
      { id: 3, paymentStatus: "paid", dueDate: "2026-09-10T00:00:00.000Z", tenantName: "Анна Ким", period: "2026-09" },
    ];
    expect(filterPaymentInvoices(invoices, { status: "issued", dueDate: "2026-09-10", payer: "ким", period: "2026-09", overdueOnly: false }, {}).map(invoice => invoice.id)).toEqual([1]);
    expect(filterPaymentInvoices(invoices, { status: "all", dueDate: "", payer: "", period: "", overdueOnly: true }, {}).map(invoice => invoice.id)).toEqual([2]);
  });
});

