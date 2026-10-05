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
  blockFolder?: string;
  tenantCategory?: string;
  /** Rate change within the term («тариф с 1 ноября»): base rate until the day before, new rate after. */
  tariffSchedule?: Array<{ from: string; to: string; tariffType: "monthly" | "daily"; amount: number }>;
};
type ImportColumn =
  | keyof Omit<ImportContractRow, "tariffSchedule">
  | "period"
  | "contractText"
  | "newTariffAmount"
  | "newTariffFrom"
  | "totalAmount";
export type ImportIssue = { row: number; message: string };

const aliases: Record<ImportColumn, string[]> = {
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
    "имя",
    "фио",
    "жилец",
    "проживающий",
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
    "тариф в тенге",
    "тариф в тенге c ндс",
    "тариф в тенге с ндс",
    "тариф с ндс",
    "стоимость в месяц",
  ],
  status: ["status", "статус", "состояние"],
  notes: ["notes", "комментарий", "примечание", "описание"],
  blockFolder: ["папка", "папка блока", "folder"],
  tenantCategory: ["категория", "категория жильца", "тип проживания", "type of tenant"],
  period: ["период проживания", "период", "срок проживания"],
  contractText: ["договор", "contract", "statement"],
  newTariffAmount: ["новый тариф", "новая ставка"],
  newTariffFrom: ["новый тариф с", "дата нового тарифа", "новая ставка с"],
  totalAmount: [
    "общая сумма",
    "общая стоимость",
    "общая сумма проживания",
    "общая сумаа проживания с учетом ком услуг",
    "общая сумма проживания с учетом ком услуг",
    "итого",
  ],
};
const MONTHS: Record<string, string> = {
  янв: "01", фев: "02", мар: "03", апр: "04", мая: "05", май: "05", июн: "06",
  июл: "07", авг: "08", сен: "09", окт: "10", ноя: "11", дек: "12",
};
/** «тариф с 1 ноября», «тариф с 01.11.2026» → { day, month, year? } */
const rateChangeHeader = (header: string) => {
  const match = header.match(/^(?:тариф|ставка|стоимость)\s+с\s+(\d{1,2})(?:\s+([а-я]+)|\s*(\d{1,2})(?:\s*(\d{4}))?)/u);
  if (!match) return null;
  const month = match[2] ? MONTHS[match[2].slice(0, 3)] : match[3]?.padStart(2, "0");
  return month ? { day: match[1].padStart(2, "0"), month, year: match[4] } : null;
};

const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[«»"'./_-]/g, " ")
    .replace(/\s+/g, " ");
const keyForHeader = (header: string) =>
  (Object.keys(aliases) as ImportColumn[]).find(key =>
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
  customMapping?: Partial<Record<keyof ImportContractRow, number>>,
  context: { fileName?: string } = {}
) {
  const matrix = await readFirstSheetMatrix(buffer);
  if (!matrix.length) throw new Error("В Excel-файле нет данных");
  const headers = (matrix[0] ?? []).map(normalizeHeader);
  const mapping: Partial<Record<ImportColumn, number>> = { ...(customMapping ?? {}) };
  let rateChange: ReturnType<typeof rateChangeHeader> = null;
  if (!customMapping)
    headers.forEach((header, index) => {
      const key = keyForHeader(header);
      if (key && mapping[key] === undefined) mapping[key] = index;
      const change = rateChangeHeader(header);
      if (change && mapping.newTariffAmount === undefined) {
        mapping.newTariffAmount = index;
        rateChange = change;
      }
    });
  // One «Период проживания: 26.08.2026 - 31.07.2027» column instead of two dates.
  const hasPeriod = mapping.period !== undefined;
  // «Договор: 501-2026 от 26.08.2026 Ariza Azam» gives the number and the date.
  const hasContractText = mapping.contractText !== undefined && mapping.contractNumber === undefined;
  const required: ImportColumn[] = ["tenantName", "tariffAmount"];
  if (!hasPeriod) required.push("startDate", "endDate");
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
  // Block for rows without an object: from the file name («38 блок таблица….xlsx») or, if every
  // contract text in the file names the same block, from the other rows.
  const BLOCK = /(?:блок\s*(\d{2,3})|(\d{2,3})\s*блок)/iu;
  const fromName = String(context.fileName ?? "").match(BLOCK);
  const textBlocks = new Set(
    mapping.contractText === undefined
      ? []
      : matrix
          .slice(1)
          .map(cells => String(cells[mapping.contractText as number] ?? "").match(BLOCK))
          .filter((m): m is RegExpMatchArray => Boolean(m))
          .map(m => m[1] ?? m[2])
  );
  const fallbackBlock = fromName ? (fromName[1] ?? fromName[2]) : textBlocks.size === 1 ? Array.from(textBlocks)[0] : null;
  const fallbackSource = fromName ? "из названия файла" : "по другим строкам файла";
  matrix.slice(1).forEach((cells, offset) => {
    const rowNumber = offset + 2;
    if (!cells.some(cell => String(cell ?? "").trim())) return;
    const value = (key: ImportColumn) =>
      mapping[key] === undefined ? "" : cells[mapping[key] as number];
    const text = (key: ImportColumn) => String(value(key) ?? "").replace(/\s+/g, " ").trim();
    const notes: string[] = [];
    let startDate = excelDate(value("startDate"));
    let endDate = excelDate(value("endDate"));
    if (hasPeriod && (!startDate || !endDate)) {
      const dates = text("period").match(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}/g) ?? [];
      startDate = startDate || excelDate(dates[0]);
      endDate = endDate || excelDate(dates[1]);
    }
    // «07.08.2026 - 31.07.2026»: the end year is a typo for the next academic year.
    if (hasPeriod && startDate && endDate && endDate < startDate) {
      const fixed = `${Number(endDate.slice(0, 4)) + 1}${endDate.slice(4)}`;
      if (fixed >= startDate) {
        notes.push(`Дата окончания в файле ${endDate.split("-").reverse().join(".")} исправлена на ${fixed.split("-").reverse().join(".")}`);
        endDate = fixed;
      }
    }
    let contractNumber = text("contractNumber") || undefined;
    let contractDate = excelDate(value("contractDate")) || undefined;
    if (hasContractText) {
      const raw = text("contractText");
      const number = raw.match(/^№?\s*([0-9][0-9A-Za-zА-Яа-я\-/.]*\d)/u)?.[1];
      const date = raw.match(/(?:от|from|dated)\s+(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/iu)?.[1];
      if (number) contractNumber = number;
      if (date) contractDate = excelDate(date) || contractDate;
    }
    const amount = Number(String(value("tariffAmount")).replace(/\s/g, "").replace(",", "."));
    // No «вид тарифа» column: the total for the stay tells daily from monthly (15 days × 7 500 = 112 500).
    let type = tariffType(value("tariffType"));
    if (!type) {
      const total = Number(String(value("totalAmount") ?? "").replace(/\s/g, "").replace(",", "."));
      const days =
        startDate && endDate
          ? Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1
          : 0;
      type = total > 0 && days > 0 && Math.abs(total - days * amount) < 1 ? "daily" : "monthly";
      if (mapping.tariffType !== undefined && text("tariffType"))
        notes.push(`Вид тарифа «${text("tariffType")}» не распознан — принят ${type === "daily" ? "суточный" : "месячный"}`);
    }
    let tariffSchedule: ImportContractRow["tariffSchedule"];
    const newAmount = Number(String(value("newTariffAmount") ?? "").replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(newAmount) && newAmount > 0 && newAmount !== amount && startDate && endDate) {
      let from = excelDate(value("newTariffFrom"));
      const change = rateChange as ReturnType<typeof rateChangeHeader>;
      if (!from && change) {
        const year = Number(change.year ?? startDate.slice(0, 4));
        from = `${year}-${change.month}-${change.day}`;
        if (!change.year && from <= startDate) from = `${year + 1}-${change.month}-${change.day}`;
      }
      if (from && from > startDate && from <= endDate) {
        const before = new Date(Date.parse(`${from}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
        tariffSchedule = [
          { from: startDate, to: before, tariffType: type, amount },
          { from, to: endDate, tariffType: type, amount: newAmount },
        ];
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    let rowStatus = status(value("status"));
    if (mapping.status === undefined && endDate && endDate < today) rowStatus = "ended";
    const textNotes = text("notes");
    const parsed: ImportContractRow = {
      contractNumber,
      contractDate,
      tenantName: text("tenantName"),
      tenantContact: text("tenantContact") || undefined,
      tenantEmail: text("tenantEmail") || undefined,
      propertyName: text("propertyName"),
      unitName: text("unitName") || undefined,
      startDate,
      endDate,
      tariffType: type,
      tariffAmount: amount,
      status: rowStatus,
      notes: [textNotes, ...notes].filter(Boolean).join("; ") || undefined,
      blockFolder: text("blockFolder") || undefined,
      tenantCategory: text("tenantCategory") || undefined,
      ...(tariffSchedule ? { tariffSchedule } : {}),
    };
    // «Тип проживания» → the app's folders for these categories.
    if (!parsed.blockFolder && parsed.tenantCategory) {
      if (/ph\.?\s*d/i.test(parsed.tenantCategory)) parsed.blockFolder = "PHD Student";
      else if (/family/i.test(parsed.tenantCategory)) parsed.blockFolder = "Family Students";
    }
    // Without an «Объект» column the block comes from the contract text («аренда 38 блок») or the folder.
    if (!parsed.propertyName) {
      const block = `${text("contractText")} ${parsed.blockFolder ?? ""}`.match(/(?:блок\s*(\d{2,3})|(\d{2,3})\s*блок)/iu);
      if (block) parsed.propertyName = `г. Астана, пр. Кабанбай батыра 53, Блок ${block[1] ?? block[2]}`;
    }
    if (!parsed.propertyName && fallbackBlock) {
      parsed.propertyName = `г. Астана, пр. Кабанбай батыра 53, Блок ${fallbackBlock}`;
      parsed.notes = [parsed.notes, `Блок ${fallbackBlock} взят ${fallbackSource} — проверьте`].filter(Boolean).join("; ");
    }
    const rowErrors: string[] = [];
    if (!parsed.tenantName) rowErrors.push("нет плательщика");
    if (!parsed.propertyName) rowErrors.push("нет объекта (добавьте колонку «Объект» или укажите блок)");
    if (!parsed.startDate || !parsed.endDate) rowErrors.push("неверная дата");
    if (parsed.startDate && parsed.endDate && parsed.startDate > parsed.endDate)
      rowErrors.push("начало позже окончания");
    if (!Number.isFinite(parsed.tariffAmount) || parsed.tariffAmount <= 0)
      rowErrors.push("неверная ставка");
    if (rowErrors.length)
      issues.push({ row: rowNumber, message: rowErrors.join(", ") });
    else rows.push(parsed);
  });
  return { headers: matrix[0] ?? [], rows, issues };
}
