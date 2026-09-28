// Uploaded files arrive as data URLs inside JSON. Nothing the client says about a file is trusted:
// the size is checked before decoding, the base64 alphabet is validated, and the real type is taken
// from the file's own signature (magic bytes), never from the declared MIME type or the file name.
import { LIMITS } from "./limits";

export type FileKind = "pdf" | "jpeg" | "png" | "xlsx";
export const MIME_BY_KIND: Record<FileKind, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejected";
  }
}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length &&
  bytes.every((byte, index) => buffer[offset + index] === byte);

/** Detects the real file type from its first bytes. */
export function sniffFileKind(buffer: Buffer): FileKind | "xls" | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "png";
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return "xlsx"; // zip container, verified further by the spreadsheet reader
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return "xls";
  // PDF readers accept a small amount of junk before the header; so do we, but no more than 1 KB.
  const head = buffer.subarray(0, 1024).toString("latin1");
  if (head.includes("%PDF-")) return "pdf";
  return null;
}

const DATA_URL = /^data:([a-z0-9.+\/-]*)(?:;[a-z0-9=._-]+)*;base64,/i;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

const KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF",
  jpeg: "JPEG",
  png: "PNG",
  xlsx: "Excel (.xlsx)",
};

/**
 * Decodes and validates an uploaded data URL.
 * @returns the bytes and the type detected from the content (use this MIME type, not the client's).
 */
export function decodeUpload(
  dataUrl: string,
  options: {
    kinds: readonly FileKind[];
    maxBytes: number;
    declaredMime?: string;
  }
) {
  const header = dataUrl.slice(0, 200).match(DATA_URL);
  if (!header) throw new UploadRejected("Некорректный файл");
  const body = dataUrl.slice(header[0].length).replace(/\s+/g, "");
  const approxBytes = Math.floor((body.length * 3) / 4);
  if (approxBytes > options.maxBytes)
    throw new UploadRejected(
      `Файл слишком большой: максимум ${Math.floor(options.maxBytes / 1024 / 1024)} МБ`
    );
  if (!body.length || body.length % 4 !== 0 || !BASE64_BODY.test(body))
    throw new UploadRejected("Файл повреждён (некорректная кодировка)");
  const buffer = Buffer.from(body, "base64");
  if (!buffer.length) throw new UploadRejected("Пустой файл");
  if (buffer.length > options.maxBytes)
    throw new UploadRejected("Файл слишком большой");
  const kind = sniffFileKind(buffer);
  if (kind === "xls")
    throw new UploadRejected(
      "Старый формат .xls не поддерживается: откройте файл в Excel и сохраните как «Книга Excel (.xlsx)»"
    );
  if (!kind || !options.kinds.includes(kind))
    throw new UploadRejected(
      `Неподдерживаемый тип файла. Допустимо: ${options.kinds.map(k => KIND_LABEL[k]).join(", ")}`
    );
  // The declared type must agree with the content (MIME confusion / polyglot guard).
  if (options.declaredMime && options.declaredMime !== MIME_BY_KIND[kind])
    throw new UploadRejected("Тип файла не совпадает с его содержимым");
  return { buffer, kind, mimeType: MIME_BY_KIND[kind] };
}

export const decodeScanUpload = (dataUrl: string, declaredMime?: string) =>
  decodeUpload(dataUrl, {
    kinds: ["pdf", "jpeg", "png"],
    maxBytes: LIMITS.scanBytes,
    declaredMime,
  });

export const decodeSpreadsheetUpload = (dataUrl: string) =>
  decodeUpload(dataUrl, { kinds: ["xlsx"], maxBytes: LIMITS.spreadsheetBytes });

/**
 * File names are only displayed (and parsed for the contract number), never used as paths:
 * control characters and markup-significant characters are removed, the length is capped.
 * Storage keys use storageSafeName() instead.
 */
export function cleanDisplayFileName(name: string) {
  const base = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f<>"|?*\\]+/g, "_")
    .trim();
  return (base || "file").slice(0, LIMITS.fileName);
}

/** Storage keys are built only from safe characters. */
export const storageSafeName = (name: string) =>
  cleanDisplayFileName(name)
    .split("/")
    .pop()!
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 80);
