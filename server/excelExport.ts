import XLSX from "xlsx-js-style";
import ExcelJS from "exceljs";
import { USM_LOGO_BASE64 } from "./logoData";
import { deriveBlockFolder } from "@shared/contractFolder";
import { toDateOnly } from "@shared/dateOnly";

const VAT_RATE = 0.16;
const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const dateOnly = (value: unknown) => toDateOnly(value as Date | string);
const daysInPeriod = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${from}T00:00:00Z`) - Date.parse(`${to}T00:00:00Z`)) / 86400000) * -1 + 1);

export const ACCRUAL_EXPORT_HEADERS = [
  "№", "Номер договора", "Дата договора", "Фактическая дата расторжения", "ФИО", "Блок",
  "Жилое помещение", "Тариф", "Вид тарифа", "Месяц расчета", "Начала расчетного периода",
  "Конец расчетного периода", "Количество дней", "Сумма отчета за период (с учетом НДС) в тенге",
  "Сумма отчета за период (без НДС) в тенге",
];

type ExportRow = {
  row: any;
  contract: any | null;
  values: unknown[];
  folder: string;
};

const REPORT_COLORS = { navy: "18202D", gold: "D8B46B", paleGold: "FFF8E8", paleBlue: "EEF5FF", border: "D9E0EA", slate: "52606D", white: "FFFFFF" } as const;
const thinBorder = { style: "thin", color: { rgb: REPORT_COLORS.border } };
const headerStyle = { fill: { fgColor: { rgb: REPORT_COLORS.navy } }, font: { bold: true, color: { rgb: REPORT_COLORS.white }, sz: 10 }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder } };
const titleStyle = { fill: { fgColor: { rgb: REPORT_COLORS.navy } }, font: { bold: true, color: { rgb: REPORT_COLORS.gold }, sz: 14 }, alignment: { vertical: "center" } };
const totalStyle = { fill: { fgColor: { rgb: REPORT_COLORS.paleGold } }, font: { bold: true, color: { rgb: REPORT_COLORS.navy } }, border: { top: { style: "medium", color: { rgb: REPORT_COLORS.gold } } } };
const bodyBorderStyle = { border: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder } };
// Excel "Денежный" format with Kazakhstani tenge (locale kk-KZ = 0x43F), so Excel shows the cell as currency ₸.
const currencyFormat = '#,##0.00 [$₸-43F]';
const dateFormat = "dd.mm.yyyy";
function styleCell(sheet: any, row: number, col: number, style: any) { const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })]; if (cell) cell.s = { ...(cell.s ?? {}), ...style }; }
function styleReportSheet(sheet: any, headers: string[], dataRows: number, currencyCols: number[] = [], dateCols: number[] = []) {
  const maxCol = headers.length - 1;
  styleCell(sheet, 0, 0, titleStyle);
  for (let col = 0; col <= maxCol; col++) styleCell(sheet, 2, col, headerStyle);
  for (let row = 3; row < 3 + dataRows; row++) for (let col = 0; col <= maxCol; col++) { styleCell(sheet, row, col, bodyBorderStyle); const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })]; if (cell && currencyCols.includes(col)) cell.z = currencyFormat; if (cell && dateCols.includes(col)) cell.z = dateFormat; }
  const totalRow = 4 + dataRows;
  for (let col = 0; col <= maxCol; col++) styleCell(sheet, totalRow, col, totalStyle);
  for (const col of currencyCols) { const cell = sheet[XLSX.utils.encode_cell({ r: totalRow, c: col })]; if (cell) cell.z = currencyFormat; }
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + dataRows, c: maxCol } }) };
  sheet["!rows"] = [{ hpt: 26 }, { hpt: 8 }, { hpt: 32 }];
}
function safeSheetName(name: string, used: Set<string>) {
  const base = name.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Без папки";
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
  const totalGross = roundCurrency(rows.reduce((sum, row) => sum + Number(row[13] ?? 0), 0));
  const totalNet = roundCurrency(rows.reduce((sum, row) => sum + Number(row[14] ?? 0), 0));
  const sheet = XLSX.utils.aoa_to_sheet([
    [title], [], headers, ...rows, [],
    ["ИТОГО за расчетный период", ...Array(headers.length - 3).fill(""), totalGross, totalNet],
  ]);
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 3 + rows.length, c: 0 }, e: { r: 3 + rows.length, c: 12 } },
  ];
  sheet["!cols"] = headers.map((_, index) => ({ wch: index === 0 ? 7 : index === 4 ? 28 : index === 13 || index === 14 ? 24 : 20 }));
  styleReportSheet(sheet, headers, rows.length, [7, 13, 14], [2, 3, 10, 11]);
  sheet["!freeze"] = { xSplit: 0, ySplit: 3 };
  return sheet;
}

async function addLogoToWorkbook(buffer: Buffer, sheetNames: string[]) {
  const report = new ExcelJS.Workbook();
  await report.xlsx.load(buffer as any);
  const imageId = report.addImage({ base64: `data:image/png;base64,${USM_LOGO_BASE64}`, extension: "png" });
  for (const name of sheetNames) {
    const sheet = report.getWorksheet(name);
    if (!sheet) continue;
    sheet.getRow(1).height = 70;
    sheet.addImage(imageId, { tl: { col: Math.max(0, sheet.columnCount - 3), row: 0 }, ext: { width: 170, height: 105 } });
  }
  return Buffer.from(await report.xlsx.writeBuffer());
}

export async function buildAccrualWorkbook(period: string, accrualRows: any[], contracts: any[]) {
  const contractById = new Map(contracts.map(contract => [contract.id, contract]));
  const exportRows: ExportRow[] = accrualRows.map((row, index) => {
    const contract = row.contractId == null ? null : contractById.get(row.contractId) ?? null;
    const serviceFrom = dateOnly(row.serviceFrom);
    const serviceTo = dateOnly(row.serviceTo);
    const gross = roundCurrency(Number(row.amount));
    const folder = deriveBlockFolder(contract?.propertyName, contract?.unitName, contract?.blockFolder);
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
        folder,
        contract?.unitName ?? row.unitName ?? "",
        Number(contract?.tariffAmount ?? row.tariffAmount ?? 0),
        (contract?.tariffType ?? row.tariffType) === "daily" ? "Суточный" : "Месячный",
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
    const contract = row.contractId == null ? null : contractById.get(row.contractId);
    const messages: string[] = [];
    if (!contract && row.contractId != null) messages.push("Связанный договор не найден");
    if (row.contractId == null) messages.push("Начисление без договора");
    if (!(contract?.tenantName ?? row.tenantName)?.trim()) messages.push("Не указан плательщик");
    if (!(contract?.tenantCategory ?? row.tenantCategory)?.trim()) messages.push("Не указана категория жильца");
    if (!(contract?.tenantNumber ?? row.tenantNumber)?.trim()) messages.push("Не указан номер жильца");
    if (!row.serviceFrom || !row.serviceTo) messages.push("Не указан период услуги");
    if (row.serviceFrom && row.serviceTo && dateOnly(row.serviceFrom) > dateOnly(row.serviceTo)) messages.push("Некорректный период услуги");
    if (!(Number(row.amount) > 0)) messages.push("Сумма должна быть больше нуля");
    return messages.map(message => [row.id, contract?.contractNumber ?? "—", contract?.tenantName ?? row.tenantName ?? "—", message]);
  });

  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const groupedEntries = (items: ExportRow[]) => { const grouped = new Map<string, ExportRow[]>(); for (const item of items) grouped.set(item.folder, [...(grouped.get(item.folder) ?? []), item]); return grouped.entries(); };
  const summaryRows = exportRows.map(item => item.values);
  const blockTotals = Array.from(groupedEntries(exportRows)).map(([folder, rows]) => [folder, rows.length, roundCurrency(rows.reduce((sum, item) => sum + Number(item.values[13] ?? 0), 0)), roundCurrency(rows.reduce((sum, item) => sum + Number(item.values[14] ?? 0), 0))]);
  const blockSummarySheet = XLSX.utils.aoa_to_sheet([[`Сводка по блокам — ${period}`], [], ["Блок", "Количество начислений", "Начислено (с НДС)", "Сумма без НДС"], ...blockTotals, [], ["ИТОГО", blockTotals.reduce((sum, row) => sum + Number(row[1] ?? 0), 0), roundCurrency(blockTotals.reduce((sum, row) => sum + Number(row[2] ?? 0), 0)), roundCurrency(blockTotals.reduce((sum, row) => sum + Number(row[3] ?? 0), 0))]]);
  blockSummarySheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  blockSummarySheet["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
  styleReportSheet(blockSummarySheet, ["Блок", "Количество начислений", "Начислено (с НДС)", "Сумма без НДС"], blockTotals.length, [2, 3]);
  XLSX.utils.book_append_sheet(workbook, blockSummarySheet, "Сводка по блокам");
  XLSX.utils.book_append_sheet(workbook, makeAccrualSheet(`Услуги проживания (физ лица) - ${period}`, ACCRUAL_EXPORT_HEADERS, summaryRows), "Начисления");

  const grouped = new Map<string, unknown[][]>();
  for (const item of exportRows) grouped.set(item.folder, [...(grouped.get(item.folder) ?? []), item.values]);
  for (const [folder, rows] of Array.from(grouped.entries())) {
    XLSX.utils.book_append_sheet(workbook, makeAccrualSheet(`${folder} — ${period}`, ACCRUAL_EXPORT_HEADERS, rows), safeSheetName(folder, usedNames));
  }

  const errorSheet = XLSX.utils.aoa_to_sheet([[`Ошибки и предупреждения — ${period}`], [], ["ID начисления", "Номер договора", "Плательщик", "Проблема"], ...errors]);
  errorSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  errorSheet["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 32 }, { wch: 42 }];
  styleCell(errorSheet, 0, 0, titleStyle);
  for (let col = 0; col < 4; col++) styleCell(errorSheet, 2, col, headerStyle);
  for (let row = 3; row < 3 + errors.length; row++) for (let col = 0; col < 4; col++) styleCell(errorSheet, row, col, bodyBorderStyle);
  errorSheet["!rows"] = [{ hpt: 26 }, { hpt: 8 }, { hpt: 26 }];
  XLSX.utils.book_append_sheet(workbook, errorSheet, safeSheetName("Ошибки", usedNames));

  return {
    buffer: await addLogoToWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" } as any), workbook.SheetNames),
    count: accrualRows.length,
    errorCount: errors.length,
    vatRate: VAT_RATE,
    sheetNames: workbook.SheetNames,
  };
}
