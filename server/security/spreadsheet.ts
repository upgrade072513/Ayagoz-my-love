// Safe reading of user-supplied Excel files.
// Replaces SheetJS "xlsx" 0.18.5 (prototype pollution CVE-2023-30533, ReDoS CVE-2024-22363; no fixed
// version on npm). Only .xlsx is accepted; the zip container is inspected before it is unpacked,
// and the result is capped in rows, columns and cell length.
import ExcelJS from "exceljs";
import { LIMITS } from "./limits";
import { UploadRejected } from "./upload";

type ZipSummary = { entries: number; uncompressed: number; names: string[] };

/** Reads the zip central directory (without inflating anything) and rejects decompression bombs. */
export function inspectZip(buffer: Buffer): ZipSummary {
  const EOCD = 0x06054b50;
  const CEN = 0x02014b50;
  const searchFrom = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= searchFrom; i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new UploadRejected("Файл Excel повреждён");
  const total = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff)
    throw new UploadRejected("Файл Excel слишком большой");
  if (total > LIMITS.spreadsheetZipEntries)
    throw new UploadRejected("Файл Excel содержит слишком много частей");
  if (cdOffset + cdSize > buffer.length)
    throw new UploadRejected("Файл Excel повреждён");
  let offset = cdOffset;
  let uncompressed = 0;
  const names: string[] = [];
  for (let n = 0; n < total; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CEN)
      throw new UploadRejected("Файл Excel повреждён");
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    if (size === 0xffffffff || compressedSize === 0xffffffff)
      throw new UploadRejected("Файл Excel слишком большой");
    if (
      compressedSize > 0 &&
      size / compressedSize > LIMITS.spreadsheetMaxRatio * 5
    )
      throw new UploadRejected("Файл Excel подозрительно сильно сжат");
    uncompressed += size;
    if (uncompressed > LIMITS.spreadsheetUnzippedBytes)
      throw new UploadRejected("Файл Excel слишком большой после распаковки");
    names.push(buffer.toString("utf8", offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (uncompressed / Math.max(1, buffer.length) > LIMITS.spreadsheetMaxRatio)
    throw new UploadRejected("Файл Excel подозрительно сильно сжат");
  return { entries: total, uncompressed, names };
}

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Plain value of an exceljs cell: string | number | boolean | Date | "". */
function cellValue(value: ExcelJS.CellValue): unknown {
  if (value == null) return "";
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string")
    return value.slice(0, LIMITS.spreadsheetCellChars);
  if (typeof value === "object") {
    const v = value as any;
    if (Array.isArray(v.richText))
      return v.richText
        .map((part: any) => String(part?.text ?? ""))
        .join("")
        .slice(0, LIMITS.spreadsheetCellChars);
    if ("result" in v) return cellValue(v.result);
    if ("text" in v)
      return String(v.text ?? "").slice(0, LIMITS.spreadsheetCellChars);
    if ("error" in v) return "";
  }
  return String(value).slice(0, LIMITS.spreadsheetCellChars);
}

async function loadWorkbook(buffer: Buffer) {
  const zip = inspectZip(buffer);
  if (
    !zip.names.includes("[Content_Types].xml") ||
    !zip.names.some(name => name.startsWith("xl/"))
  )
    throw new UploadRejected("Это не файл Excel (.xlsx)");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new UploadRejected("Не удалось прочитать файл Excel");
  }
  if (!workbook.worksheets.length)
    throw new UploadRejected("В Excel-файле нет листов");
  return workbook;
}

function sheetMatrix(sheet: ExcelJS.Worksheet): unknown[][] {
  if (sheet.rowCount > LIMITS.spreadsheetRows + 1)
    throw new UploadRejected(
      `В файле слишком много строк: максимум ${LIMITS.spreadsheetRows}`
    );
  const width = Math.min(sheet.columnCount, LIMITS.spreadsheetColumns);
  const matrix: unknown[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: unknown[] = [];
    for (let c = 1; c <= width; c++)
      cells.push(cellValue(row.getCell(c).value));
    matrix.push(cells);
  }
  // Trailing empty rows are not data.
  while (
    matrix.length &&
    !matrix[matrix.length - 1].some(cell => String(cell ?? "").trim())
  )
    matrix.pop();
  return matrix;
}

/** First worksheet as a matrix (like SheetJS sheet_to_json with header: 1, defval: ""). */
export async function readFirstSheetMatrix(
  buffer: Buffer
): Promise<unknown[][]> {
  const workbook = await loadWorkbook(buffer);
  return sheetMatrix(workbook.worksheets[0]);
}

/** Every worksheet (up to 24) as { name, matrix }. */
export async function readAllSheetMatrices(
  buffer: Buffer
): Promise<Array<{ name: string; matrix: unknown[][] }>> {
  const workbook = await loadWorkbook(buffer);
  let total = 0;
  return workbook.worksheets.slice(0, 24).map(sheet => {
    const matrix = sheetMatrix(sheet);
    total += matrix.length;
    if (total > LIMITS.spreadsheetRows * 2)
      throw new UploadRejected(
        `В файле слишком много строк: максимум ${LIMITS.spreadsheetRows * 2}`
      );
    return { name: sheet.name, matrix };
  });
}

/** Header row → objects (like SheetJS sheet_to_json with defval: ""), safe against prototype pollution. */
export function matrixToObjects(
  matrix: unknown[][]
): Record<string, unknown>[] {
  const [headerRow = [], ...rows] = matrix;
  const seen = new Map<string, number>();
  const headers = headerRow.map((cell, index) => {
    let name = String(cell ?? "").trim() || `__EMPTY_${index}`;
    if (FORBIDDEN_KEYS.has(name)) name = `_${name}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count ? `${name}_${count}` : name;
  });
  return rows
    .filter(cells => cells.some(cell => String(cell ?? "").trim()))
    .map(cells => {
      const record: Record<string, unknown> = Object.create(null);
      headers.forEach((header, index) => {
        record[header] = cells[index] ?? "";
      });
      return record;
    });
}

/** Excel serial date (1900 system) → YYYY-MM-DD. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
