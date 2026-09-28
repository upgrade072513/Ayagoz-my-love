import { describe, expect, it } from "vitest";
import { buildInvoiceEmail } from "./email";

describe("invoice email", () => {
  it("calculates the fixed due date as the 10th of the selected month", () => {
    expect(
      buildInvoiceEmail({
        invoiceNumber: "INV-1",
        tenantName: "Иван Иванов",
        recipient: "ivan@example.com",
        period: "2026-08",
        totalAmount: "116000.00",
        items: [],
      }).dueDate
    ).toBe("2026-08-10");
  });

  it("includes the payment options and invoice details in html and text", () => {
    const email = buildInvoiceEmail({
      invoiceNumber: "INV-1",
      tenantName: "Иван Иванов",
      recipient: "ivan@example.com",
      period: "2026-08",
      totalAmount: "116000.00",
      items: [
        {
          description: "Услуги проживания 2026-08-01 — 2026-08-31",
          amount: "116000.00",
        },
      ],
    });

    expect(email.subject).toContain("INV-1");
    expect(email.html).toContain("не позднее 10 августа 2026 года");
    expect(email.html).toContain("Reception Desk (Block A1, Room 38)");
    expect(email.html).toContain("my.nu.edu.kz");
    expect(email.text).toContain("Payment Link from Block Manager");
  });
});
