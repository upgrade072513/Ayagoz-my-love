import { describe, expect, it } from "vitest";
import XLSX from "xlsx";
import { parsePaymentsExcel } from "./paymentImport";

const workbookBuffer = (rows: unknown[][]) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Платежи"
  );
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
  );
};

describe("payment Excel import", () => {
  it("parses Russian payment headers and localized methods", () => {
    const result = parsePaymentsExcel(
      workbookBuffer([
        [
          "№ счёта",
          "Сумма платежа",
          "Дата оплаты",
          "Способ оплаты",
          "Номер транзакции",
        ],
        ["INV-2026-001", "1 250,50", "21.08.2026", "Портал", "TX-1"],
      ])
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        invoiceNumber: "INV-2026-001",
        amount: 1250.5,
        paidAt: "2026-08-21",
        method: "portal",
        reference: "TX-1",
        note: undefined,
      },
    ]);
  });

  it("parses English headers and reports row-level validation errors", () => {
    const result = parsePaymentsExcel(
      workbookBuffer([
        ["Invoice Number", "Amount", "Payment Date", "Method"],
        ["INV-1", 100, "2026-08-21", "bank"],
        ["", -2, "bad", "bank"],
      ])
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      invoiceNumber: "INV-1",
      amount: 100,
      paidAt: "2026-08-21",
      method: "bank",
    });
    expect(result.errors).toEqual([
      {
        row: 3,
        message:
          "не указан номер счёта, сумма должна быть больше нуля, неверная дата оплаты",
      },
    ]);
  });
});
