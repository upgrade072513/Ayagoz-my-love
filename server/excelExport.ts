import XLSX from "xlsx-js-style";
import ExcelJS from "exceljs";
import { USM_LOGO_BASE64 } from "./logoData";
import { DEFAULT_BLOCK_FOLDER, buildingOf, deriveBlockFolder } from "@shared/contractFolder";
import { toDateOnly } from "@shared/dateOnly";

const VAT_RATE = 0.16;
const roundCurrency = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const dateOnly = (value: unknown) => toDateOnly(value as Date | string);
const daysInPeriod = (from: string, to: string) =>
  Math.max(
    0,
    Math.round(
      (Date.parse(`${from}T00:00:00Z`) - Date.parse(`${to}T00:00:00Z`)) /
        86400000
    ) *
      -1 +
      1
  );

export const ACCRUAL_EXPORT_HEADERS = [
  "№",
  "Номер договора",
  "Дата договора",
  "Фактическая дата расторжения",
  "ФИО",
  "Блок",
  "Жилое помещение",
  "Тариф",
  "Вид тарифа",
  "Месяц расчета",
  "Начала расчетного периода",
  "Конец расчетного периода",
  "Количество дней",
  "Сумма отчета за период (с учетом НДС) в тенге",
  "Сумма отчета за период (без НДС) в тенге",
];

type ExportRow = {
  row: any;
  contract: any | null;
  values: unknown[];
  folder: string;
};

const REPORT_COLORS = {
  navy: "18202D",
  gold: "D8B46B",
  paleGold: "FFF8E8",
  paleBlue: "EEF5FF",
  border: "D9E0EA",
  slate: "52606D",
  white: "FFFFFF",
} as const;
const thinBorder = { style: "thin", color: { rgb: REPORT_COLORS.border } };
const headerStyle = {
  fill: { fgColor: { rgb: REPORT_COLORS.navy } },
  font: { bold: true, color: { rgb: REPORT_COLORS.white }, sz: 10 },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: {
    top: thinBorder,
    bottom: thinBorder,
    left: thinBorder,
    right: thinBorder,
  },
};
const titleStyle = {
  fill: { fgColor: { rgb: REPORT_COLORS.navy } },
  font: { bold: true, color: { rgb: REPORT_COLORS.gold }, sz: 14 },
  alignment: { vertical: "center" },
};
const totalStyle = {
  fill: { fgColor: { rgb: REPORT_COLORS.paleGold } },
  font: { bold: true, color: { rgb: REPORT_COLORS.navy } },
  border: { top: { style: "medium", color: { rgb: REPORT_COLORS.gold } } },
};
const bodyBorderStyle = {
  border: {
    top: thinBorder,
    bottom: thinBorder,
    left: thinBorder,
    right: thinBorder,
  },
};
// Excel "Денежный" format with Kazakhstani tenge (locale kk-KZ = 0x43F), so Excel shows the cell as currency ₸.
const currencyFormat = "#,##0.00 [$₸-43F]";
const dateFormat = "dd.mm.yyyy";
function styleCell(sheet: any, row: number, col: number, style: any) {
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  if (cell) cell.s = { ...(cell.s ?? {}), ...style };
}
function styleReportSheet(
  sheet: any,
  headers: string[],
  dataRows: number,
  currencyCols: number[] = [],
  dateCols: number[] = []
) {
  const maxCol = headers.length - 1;
  styleCell(sheet, 0, 0, titleStyle);
  for (let col = 0; col <= maxCol; col++) styleCell(sheet, 2, col, headerStyle);
  for (let row = 3; row < 3 + dataRows; row++)
    for (let col = 0; col <= maxCol; col++) {
      styleCell(sheet, row, col, bodyBorderStyle);
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell && currencyCols.includes(col)) cell.z = currencyFormat;
      if (cell && dateCols.includes(col)) cell.z = dateFormat;
    }
  const totalRow = 4 + dataRows;
  for (let col = 0; col <= maxCol; col++)
    styleCell(sheet, totalRow, col, totalStyle);
  for (const col of currencyCols) {
    const cell = sheet[XLSX.utils.encode_cell({ r: totalRow, c: col })];
    if (cell) cell.z = currencyFormat;
  }
  sheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: 2, c: 0 },
      e: { r: 2 + dataRows, c: maxCol },
    }),
  };
  sheet["!rows"] = [{ hpt: 26 }, { hpt: 8 }, { hpt: 32 }];
}
function safeSheetName(name: string, used: Set<string>) {
  const base =
    name
      .replace(/[\\/*?:[\]]/g, " ")
      .trim()
      .slice(0, 31) || "Без папки";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = ` ${suffix++}`;
    candidate = `${base.slice(0, 31 - tail.length)}${tail}`;
  }
  used.add(candidate);
  return candidate;
}

function makeAccrualSheet(title: string, headers: string[], rows: unknown[][]) {
  const totalGross = roundCurrency(
    rows.reduce((sum, row) => sum + Number(row[13] ?? 0), 0)
  );
  const totalNet = roundCurrency(
    rows.reduce((sum, row) => sum + Number(row[14] ?? 0), 0)
  );
  // ISO date strings → real Excel dates (shown as dd.mm.yyyy, sortable and filterable as dates).
  const DATE_COLS = [2, 3, 10, 11];
  rows = rows.map((row, rowIndex) =>
    row.map((value, index) => {
      // «№» is numbered within each sheet (1, 2, 3 … on every block sheet), not copied from the main list.
      if (index === 0) return rowIndex + 1;
      const match = DATE_COLS.includes(index) && typeof value === "string" ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
      // Excel serial day number (no time zone drift); the dd.mm.yyyy format is applied below.
      return match
        ? (Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - Date.UTC(1899, 11, 30)) / 86400000
        : value;
    })
  );
  const sheet = XLSX.utils.aoa_to_sheet([
    [title],
    [],
    headers,
    ...rows,
    [],
    [
      "ИТОГО за расчетный период",
      ...Array(headers.length - 3).fill(""),
      totalGross,
      totalNet,
    ],
  ]);
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    // «ИТОГО за расчетный период» row: title, headers, rows, an empty row, then the totals.
    { s: { r: 4 + rows.length, c: 0 }, e: { r: 4 + rows.length, c: 12 } },
  ];
  sheet["!cols"] = headers.map((_, index) => ({
    wch:
      index === 0
        ? 7
        : index === 4
          ? 28
          : index === 13 || index === 14
            ? 24
            : 20,
  }));
  styleReportSheet(sheet, headers, rows.length, [7, 13, 14], [2, 3, 10, 11]);
  sheet["!freeze"] = { xSplit: 0, ySplit: 3 };
  return sheet;
}

/**
 * Column widths from the content (like Excel's «Автоподбор ширины»): the longest value in each column
 * below the title, numbers measured as they are displayed («1 234 567,89»), headers by their longest word
 * (headers wrap). Clamped so one long note does not make a column screen-wide.
 */
export function autoFitColumns(sheet: XLSX.WorkSheet, headerRow = 2) {
  const ref = sheet["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  // Text in merged cells (title, «ИТОГО…») spans several columns and must not widen the first one.
  const merged = (r: number, c: number) =>
    (sheet["!merges"] ?? []).some(
      m => m.e.c > m.s.c && r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c
    );
  const widths: number[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let width = 6;
    for (let r = Math.max(range.s.r, headerRow); r <= range.e.r; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v == null || cell.v === "" || merged(r, c)) continue;
      let length: number;
      if (typeof cell.v === "number")
        length = cell.v.toLocaleString("ru-RU", { minimumFractionDigits: Number.isInteger(cell.v) ? 0 : 2, maximumFractionDigits: 2 }).length + 1;
      else if (cell.v instanceof Date) length = 10;
      else if (r === headerRow)
        length = Math.max(...String(cell.v).split(/\s+/).map(word => word.length)) + 2;
      else length = Math.max(...String(cell.v).split("\n").map(line => line.length));
      width = Math.max(width, length + 2);
    }
    widths.push(Math.min(width, 60));
  }
  sheet["!cols"] = widths.map(wch => ({ wch }));
  // Header cells wrap: give the header row enough height for its longest header.
  let lines = 1;
  widths.forEach((wch, index) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c: range.s.c + index })];
    if (cell?.v != null) lines = Math.max(lines, Math.ceil(String(cell.v).length / Math.max(1, wch - 2)));
  });
  const rows = (sheet["!rows"] ?? []) as XLSX.RowInfo[];
  rows[headerRow] = { ...(rows[headerRow] ?? {}), hpt: Math.max(rows[headerRow]?.hpt ?? 0, 15 * Math.min(lines, 4) + 6) };
  sheet["!rows"] = rows;
}

/** Same autofit, applied to the final ExcelJS workbook (what Excel actually opens). */
function fitColumnsExcelJs(sheet: ExcelJS.Worksheet, headerRow = 3) {
  const mergedRanges: string[] = ((sheet as any).model?.merges ?? []) as string[];
  const merged = new Set<string>();
  for (const range of mergedRanges) {
    const [from, to] = range.split(":");
    if (!to) continue;
    const start = sheet.getCell(from);
    const end = sheet.getCell(to);
    if (Number(end.col) <= Number(start.col)) continue;
    for (let r = Number(start.row); r <= Number(end.row); r++)
      for (let c = Number(start.col); c <= Number(end.col); c++) merged.add(`${r}:${c}`);
  }
  const widths = new Map<number, number>();
  let headerLines = 1;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < headerRow) return;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (merged.has(`${rowNumber}:${colNumber}`)) return;
      const value = cell.value as unknown;
      if (value == null || value === "") return;
      let length: number;
      if (typeof value === "number") {
        const shown = value.toLocaleString("ru-RU", {
          minimumFractionDigits: cell.numFmt?.includes("0.00") ? 2 : 0,
          maximumFractionDigits: 2,
        });
        length = shown.length + (cell.numFmt?.includes("₸") ? 5 : 1);
      } else if (value instanceof Date) length = 10;
      else if (rowNumber === headerRow)
        length = Math.max(...String((value as any)?.richText ? (value as any).richText.map((p: any) => p.text).join("") : value).split(/\s+/).map(word => word.length)) + 3; // + filter arrow
      else length = Math.max(...String((value as any)?.text ?? (value as any)?.result ?? value).split("\n").map(line => line.length));
      widths.set(colNumber, Math.max(widths.get(colNumber) ?? 6, Math.min(length + 2, 60)));
    });
  });
  widths.forEach((width, col) => {
    sheet.getColumn(col).width = width;
  });
  // Header row tall enough for wrapped headers.
  const header = sheet.getRow(headerRow);
  header.eachCell({ includeEmpty: false }, (cell, col) => {
    const width = widths.get(col) ?? 10;
    headerLines = Math.max(headerLines, Math.ceil(String(cell.value ?? "").length / Math.max(1, width - 3)));
  });
  header.height = Math.max(header.height ?? 0, 15 * Math.min(headerLines, 5) + 6);
}

async function addLogoToWorkbook(buffer: Buffer, sheetNames: string[]) {
  const report = new ExcelJS.Workbook();
  await report.xlsx.load(buffer as any);
  const imageId = report.addImage({
    base64: `data:image/png;base64,${USM_LOGO_BASE64}`,
    extension: "png",
  });
  for (const name of sheetNames) {
    const sheet = report.getWorksheet(name);
    if (!sheet) continue;
    // Required by Excel: without defaultRowHeight the file opens as «[восстановлено]» and loses column widths.
    sheet.properties.defaultRowHeight = 15;
    fitColumnsExcelJs(sheet);
    sheet.getRow(1).height = 70;
    sheet.addImage(imageId, {
      tl: { col: Math.max(0, sheet.columnCount - 3), row: 0 },
      ext: { width: 170, height: 105 },
    });
  }
  return Buffer.from(await report.xlsx.writeBuffer());
}

export async function buildAccrualWorkbook(
  period: string,
  accrualRows: any[],
  contracts: any[]
) {
  const contractById = new Map(
    contracts.map(contract => [contract.id, contract])
  );
  const exportRows: ExportRow[] = accrualRows.map((row, index) => {
    const contract =
      row.contractId == null
        ? null
        : (contractById.get(row.contractId) ?? null);
    const serviceFrom = dateOnly(row.serviceFrom);
    const serviceTo = dateOnly(row.serviceTo);
    const gross = roundCurrency(Number(row.amount));
    const ownFolder = deriveBlockFolder(
      contract?.propertyName ?? row.propertyName,
      contract?.unitName ?? row.unitName,
      contract?.blockFolder
    );
    // Category folders (Family Students, PhD) are one sheet each, whatever the folder spelling;
    // their «Блок» column shows the building the resident actually lives in (А1 = 38, А2 = 44 …).
    const category = /family/i.test(ownFolder)
      ? "Family Students"
      : /ph\.?\s*d/i.test(ownFolder)
        ? "PHD Student"
        : null;
    const building = buildingOf(
      contract?.propertyName ?? row.propertyName,
      contract?.unitName ?? row.unitName,
      ownFolder
    );
    const folder = category ?? ownFolder;
    const blockLabel =
      category && building !== DEFAULT_BLOCK_FOLDER ? building : category ? "—" : ownFolder;
    return {
      row,
      contract,
      folder,
      values: [
        index + 1,
        contract?.contractNumber ?? contract?.id ?? row.contractId,
        contract?.contractDate ? dateOnly(contract.contractDate) : "",
        contract?.terminationDate ? dateOnly(contract.terminationDate) : "",
        contract?.tenantName ?? row.tenantName ?? "Без договора",
        blockLabel,
        contract?.unitName ?? row.unitName ?? "",
        Number(contract?.tariffAmount ?? row.tariffAmount ?? 0),
        (contract?.tariffType ?? row.tariffType) === "daily"
          ? "Суточный"
          : "Месячный",
        row.period,
        serviceFrom,
        serviceTo,
        daysInPeriod(serviceFrom, serviceTo),
        gross,
        roundCurrency(gross / (1 + VAT_RATE)),
      ],
    };
  });

  const errors = accrualRows.flatMap(row => {
    const contract =
      row.contractId == null ? null : contractById.get(row.contractId);
    const messages: string[] = [];
    if (!contract && row.contractId != null)
      messages.push("Связанный договор не найден");
    if (row.contractId == null) messages.push("Начисление без договора");
    if (!(contract?.tenantName ?? row.tenantName)?.trim())
      messages.push("Не указан плательщик");
    if (!(contract?.tenantCategory ?? row.tenantCategory)?.trim())
      messages.push("Не указана категория жильца");
    if (!(contract?.tenantNumber ?? row.tenantNumber)?.trim())
      messages.push("Не указан номер жильца");
    if (!row.serviceFrom || !row.serviceTo)
      messages.push("Не указан период услуги");
    if (
      row.serviceFrom &&
      row.serviceTo &&
      dateOnly(row.serviceFrom) > dateOnly(row.serviceTo)
    )
      messages.push("Некорректный период услуги");
    if (!(Number(row.amount) > 0))
      messages.push("Сумма должна быть больше нуля");
    {
      const own = deriveBlockFolder(contract?.propertyName ?? row.propertyName, contract?.unitName ?? row.unitName, contract?.blockFolder);
      const building = buildingOf(contract?.propertyName ?? row.propertyName, contract?.unitName ?? row.unitName, own);
      if (/family|ph\.?\s*d/i.test(own) && building === DEFAULT_BLOCK_FOLDER)
        messages.push("В адресе не указан блок проживания (38/39/44/45) — в столбце «Блок» стоит «—». Укажите блок в договоре («Указать блок» в реестре)");
    }
    return messages.map(message => [
      row.id,
      contract?.contractNumber ?? "—",
      contract?.tenantName ?? row.tenantName ?? "—",
      message,
    ]);
  });

  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const groupedEntries = (items: ExportRow[]) => {
    const grouped = new Map<string, ExportRow[]>();
    for (const item of items)
      grouped.set(item.folder, [...(grouped.get(item.folder) ?? []), item]);
    return grouped.entries();
  };
  const summaryRows = exportRows.map(item => item.values);
  const blockTotals = Array.from(groupedEntries(exportRows)).map(
    ([folder, rows]) => [
      folder,
      rows.length,
      roundCurrency(
        rows.reduce((sum, item) => sum + Number(item.values[13] ?? 0), 0)
      ),
      roundCurrency(
        rows.reduce((sum, item) => sum + Number(item.values[14] ?? 0), 0)
      ),
    ]
  );
  const blockSummarySheet = XLSX.utils.aoa_to_sheet([
    [`Сводка по блокам — ${period}`],
    [],
    ["Блок", "Количество начислений", "Начислено (с НДС)", "Сумма без НДС"],
    ...blockTotals,
    [],
    [
      "ИТОГО",
      blockTotals.reduce((sum, row) => sum + Number(row[1] ?? 0), 0),
      roundCurrency(
        blockTotals.reduce((sum, row) => sum + Number(row[2] ?? 0), 0)
      ),
      roundCurrency(
        blockTotals.reduce((sum, row) => sum + Number(row[3] ?? 0), 0)
      ),
    ],
  ]);
  // Family Students / PHD Student by building (А1 = 38, А2 = 44 …), below the main summary.
  const categoryBreakdown: unknown[][] = [];
  for (const category of ["Family Students", "PHD Student"]) {
    const items = exportRows.filter(item => item.folder === category);
    if (!items.length) continue;
    const byBuilding = new Map<string, ExportRow[]>();
    for (const item of items) {
      const building = String(item.values[5] ?? "—");
      byBuilding.set(building, [...(byBuilding.get(building) ?? []), item]);
    }
    for (const [building, rows] of Array.from(byBuilding.entries()).sort((a, b) => a[0].localeCompare(b[0], "ru")))
      categoryBreakdown.push([
        `${category} — ${building}`,
        rows.length,
        roundCurrency(rows.reduce((sum, item) => sum + Number(item.values[13] ?? 0), 0)),
        roundCurrency(rows.reduce((sum, item) => sum + Number(item.values[14] ?? 0), 0)),
      ]);
  }
  if (categoryBreakdown.length) {
    const start = 2 + 1 + blockTotals.length + 2 + 2; // header row, rows, blank, ИТОГО, blank
    XLSX.utils.sheet_add_aoa(
      blockSummarySheet,
      [["В т.ч. Family Students и PHD Student по блокам проживания", "", "", ""], ...categoryBreakdown],
      { origin: { r: start, c: 0 } }
    );
    styleCell(blockSummarySheet, start, 0, { font: { bold: true, color: { rgb: REPORT_COLORS.navy } } });
    for (let r = start + 1; r <= start + categoryBreakdown.length; r++)
      for (let c = 0; c < 4; c++) {
        styleCell(blockSummarySheet, r, c, bodyBorderStyle);
        const cell = blockSummarySheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && c >= 2) cell.z = currencyFormat;
      }
  }
  blockSummarySheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  blockSummarySheet["!cols"] = [
    { wch: 28 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
  ];
  styleReportSheet(
    blockSummarySheet,
    ["Блок", "Количество начислений", "Начислено (с НДС)", "Сумма без НДС"],
    blockTotals.length,
    [2, 3]
  );
  XLSX.utils.book_append_sheet(workbook, blockSummarySheet, "Сводка по блокам");
  XLSX.utils.book_append_sheet(
    workbook,
    makeAccrualSheet(
      `Услуги проживания (физ лица) - ${period}`,
      ACCRUAL_EXPORT_HEADERS,
      summaryRows
    ),
    "Начисления"
  );

  const grouped = new Map<string, unknown[][]>();
  for (const item of exportRows)
    grouped.set(item.folder, [
      ...(grouped.get(item.folder) ?? []),
      item.values,
    ]);
  for (const [folder, rows] of Array.from(grouped.entries())) {
    XLSX.utils.book_append_sheet(
      workbook,
      makeAccrualSheet(`${folder} — ${period}`, ACCRUAL_EXPORT_HEADERS, rows),
      safeSheetName(folder, usedNames)
    );
  }

  const errorSheet = XLSX.utils.aoa_to_sheet([
    [`Ошибки и предупреждения — ${period}`],
    [],
    ["ID начисления", "Номер договора", "Плательщик", "Проблема"],
    ...errors,
  ]);
  errorSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  errorSheet["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 32 }, { wch: 42 }];
  styleCell(errorSheet, 0, 0, titleStyle);
  for (let col = 0; col < 4; col++) styleCell(errorSheet, 2, col, headerStyle);
  for (let row = 3; row < 3 + errors.length; row++)
    for (let col = 0; col < 4; col++)
      styleCell(errorSheet, row, col, bodyBorderStyle);
  errorSheet["!rows"] = [{ hpt: 26 }, { hpt: 8 }, { hpt: 26 }];
  XLSX.utils.book_append_sheet(
    workbook,
    errorSheet,
    safeSheetName("Ошибки", usedNames)
  );

  for (const name of workbook.SheetNames) autoFitColumns(workbook.Sheets[name]);
  return {
    buffer: await addLogoToWorkbook(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" } as any),
      workbook.SheetNames
    ),
    count: accrualRows.length,
    errorCount: errors.length,
    vatRate: VAT_RATE,
    sheetNames: workbook.SheetNames,
  };
}
