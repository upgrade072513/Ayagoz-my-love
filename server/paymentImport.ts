import XLSX from "xlsx";

const fieldAliases = {
  invoiceNumber: [
    "номер счета",
    "номер счёта",
    "счет",
    "счёт",
    "счета",
    "счёта",
    "invoice",
    "invoice number",
  ],
  amount: ["сумма", "сумма платежа", "amount", "payment amount"],
  paidAt: ["дата оплаты", "дата платежа", "дата", "paid at", "payment date"],
  method: ["способ оплаты", "способ", "method", "payment method"],
  reference: ["номер транзакции", "транзакция", "reference", "transaction"],
  note: ["примечание", "комментарий", "note", "comment"],
} as const;

const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/[№:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const findValue = (
  row: Record<string, unknown>,
  aliases: readonly string[]
) => {
  const key = Object.keys(row).find(candidate =>
    aliases.includes(normalizeHeader(candidate))
  );
  return key ? row[key] : undefined;
};
const toDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (iso)
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const local = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (local)
    return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  return "";
};

export type PaymentImportRow = {
  invoiceNumber: string;
  amount: number;
  paidAt: string;
  method: "bank" | "portal" | "card" | "cash" | "other";
  reference?: string;
  note?: string;
};
export type PaymentImportError = { row: number; message: string };

export function parsePaymentsExcel(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!sheet)
    return {
      rows: [] as PaymentImportRow[],
      errors: [{ row: 1, message: "В файле нет листов" }],
    };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });
  const rows: PaymentImportRow[] = [];
  const errors: PaymentImportError[] = [];
  raw.forEach((source, index) => {
    const rowNumber = index + 2;
    const invoiceNumber = String(
      findValue(source, fieldAliases.invoiceNumber) ?? ""
    ).trim();
    const amount = Number(
      String(findValue(source, fieldAliases.amount) ?? "")
        .replace(/\s/g, "")
        .replace(",", ".")
    );
    const paidAt = toDate(findValue(source, fieldAliases.paidAt));
    const methodValue = String(findValue(source, fieldAliases.method) ?? "bank")
      .trim()
      .toLocaleLowerCase("ru-RU");
    const method =
      methodValue === "портал" || methodValue === "portal"
        ? "portal"
        : methodValue === "карта" || methodValue === "card"
          ? "card"
          : methodValue === "наличные" || methodValue === "cash"
            ? "cash"
            : methodValue === "прочее" || methodValue === "other"
              ? "other"
              : "bank";
    const rowErrors: string[] = [];
    if (!invoiceNumber) rowErrors.push("не указан номер счёта");
    if (!Number.isFinite(amount) || amount <= 0)
      rowErrors.push("сумма должна быть больше нуля");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt))
      rowErrors.push("неверная дата оплаты");
    if (rowErrors.length) {
      errors.push({ row: rowNumber, message: rowErrors.join(", ") });
      return;
    }
    rows.push({
      invoiceNumber,
      amount,
      paidAt,
      method,
      reference:
        String(findValue(source, fieldAliases.reference) ?? "").trim() ||
        undefined,
      note:
        String(findValue(source, fieldAliases.note) ?? "").trim() || undefined,
    });
  });
  return { rows, errors };
}
