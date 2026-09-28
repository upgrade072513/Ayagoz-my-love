import { excelSerialToIso, readFirstSheetMatrix } from "./security/spreadsheet";

export type ImportContractRow = {
  contractNumber?: string;
  contractDate?: string;
  tenantName: string;
  tenantContact?: string;
  tenantEmail?: string;
  propertyName: string;
  unitName?: string;
  startDate: string;
  endDate: string;
  tariffType: "monthly" | "daily";
  tariffAmount: number;
  status: "active" | "paused" | "ended";
  notes?: string;
};
export type ImportIssue = { row: number; message: string };

const aliases: Record<keyof ImportContractRow, string[]> = {
  contractNumber: [
    "contractnumber",
    "contract no",
    "contract number",
    "номер договора",
    "№ договора",
    "договор №",
  ],
  contractDate: [
    "contractdate",
    "contract date",
    "дата договора",
    "дата заключения договора",
    "дата заключения",
  ],
  tenantName: [
    "tenantname",
    "tenant",
    "плательщик",
    "арендатор",
    "наименование плательщика",
    "контрагент",
  ],
  tenantContact: [
    "tenantcontact",
    "contact",
    "контакт",
    "телефон",
    "телефон/email",
  ],
  tenantEmail: ["tenantemail", "email", "e-mail", "электронная почта", "почта"],
  propertyName: [
    "propertyname",
    "property",
    "объект",
    "объект размещения",
    "здание",
  ],
  unitName: [
    "unitname",
    "unit",
    "помещение",
    "номер",
    "комната",
    "номер комнаты",
  ],
  startDate: ["startdate", "start", "дата начала", "начало", "действует с"],
  endDate: ["enddate", "end", "дата окончания", "окончание", "действует по"],
  tariffType: [
    "tarifftype",
    "tariff type",
    "вид тарифа",
    "тип тарифа",
    "тариф",
  ],
  tariffAmount: [
    "tariffamount",
    "amount",
    "ставка",
    "тарифная ставка",
    "сумма тарифа",
    "цена",
  ],
  status: ["status", "статус", "состояние"],
  notes: ["notes", "комментарий", "примечание", "описание"],
};

const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[«»"'./_-]/g, " ")
    .replace(/\s+/g, " ");
const keyForHeader = (header: string) =>
  (Object.keys(aliases) as Array<keyof ImportContractRow>).find(key =>
    aliases[key].some(alias => normalizeHeader(alias) === header)
  );
const excelDate = (value: unknown): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = excelSerialToIso(value);
    if (date) return date;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (match)
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return "";
};
const tariffType = (value: unknown): "monthly" | "daily" | null => {
  const raw = normalizeHeader(value);
  if (["monthly", "month", "месячный", "месяц", "в месяц"].includes(raw))
    return "monthly";
  if (
    [
      "daily",
      "day",
      "суточный",
      "суточный тариф",
      "сутки",
      "за сутки",
    ].includes(raw)
  )
    return "daily";
  return null;
};
const status = (value: unknown): "active" | "paused" | "ended" => {
  const raw = normalizeHeader(value);
  if (["paused", "приостановлен", "пауза"].includes(raw)) return "paused";
  if (["ended", "завершен", "завершён", "закрыт"].includes(raw)) return "ended";
  return "active";
};

export async function parseContractsExcel(
  buffer: Buffer,
  customMapping?: Partial<Record<keyof ImportContractRow, number>>
) {
  const matrix = await readFirstSheetMatrix(buffer);
  if (!matrix.length) throw new Error("В Excel-файле нет данных");
  const headers = (matrix[0] ?? []).map(normalizeHeader);
  const mapping: Partial<Record<keyof ImportContractRow, number>> =
    customMapping ?? {};
  if (!customMapping)
    headers.forEach((header, index) => {
      const key = keyForHeader(header);
      if (key) mapping[key] = index;
    });
  const required: Array<keyof ImportContractRow> = [
    "tenantName",
    "propertyName",
    "startDate",
    "endDate",
    "tariffType",
    "tariffAmount",
  ];
  const missing = required.filter(key => mapping[key] === undefined);
  if (missing.length)
    return {
      headers: matrix[0] ?? [],
      rows: [],
      issues: [
        {
          row: 1,
          message: `Не найдены обязательные колонки: ${missing.join(", ")}`,
        },
      ],
    };
  const rows: ImportContractRow[] = [];
  const issues: ImportIssue[] = [];
  matrix.slice(1).forEach((cells, offset) => {
    const rowNumber = offset + 2;
    if (!cells.some(cell => String(cell ?? "").trim())) return;
    const value = (key: keyof ImportContractRow) =>
      mapping[key] === undefined ? "" : cells[mapping[key] as number];
    const parsed: ImportContractRow = {
      contractNumber: String(value("contractNumber") ?? "").trim() || undefined,
      contractDate: excelDate(value("contractDate")) || undefined,
      tenantName: String(value("tenantName")).trim(),
      tenantContact: String(value("tenantContact") ?? "").trim() || undefined,
      tenantEmail: String(value("tenantEmail") ?? "").trim() || undefined,
      propertyName: String(value("propertyName")).trim(),
      unitName: String(value("unitName") ?? "").trim() || undefined,
      startDate: excelDate(value("startDate")),
      endDate: excelDate(value("endDate")),
      tariffType: tariffType(value("tariffType")) ?? "monthly",
      tariffAmount: Number(
        String(value("tariffAmount")).replace(/\s/g, "").replace(",", ".")
      ),
      status: status(value("status")),
      notes: String(value("notes") ?? "").trim() || undefined,
    };
    const rowErrors: string[] = [];
    if (!parsed.tenantName) rowErrors.push("нет плательщика");
    if (!parsed.propertyName) rowErrors.push("нет объекта");
    if (!parsed.startDate || !parsed.endDate) rowErrors.push("неверная дата");
    if (parsed.startDate && parsed.endDate && parsed.startDate > parsed.endDate)
      rowErrors.push("начало позже окончания");
    if (!Number.isFinite(parsed.tariffAmount) || parsed.tariffAmount <= 0)
      rowErrors.push("неверная ставка");
    if (!tariffType(value("tariffType")))
      rowErrors.push("неизвестный вид тарифа");
    if (rowErrors.length)
      issues.push({ row: rowNumber, message: rowErrors.join(", ") });
    else rows.push(parsed);
  });
  return { headers: matrix[0] ?? [], rows, issues };
}
