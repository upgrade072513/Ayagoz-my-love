// Upper bounds for everything a signed-in user can send. One place, so reviews and tests agree.
export const LIMITS = {
  /** Largest HTTP body accepted by /api/trpc (a 15 MB scan is ~20 MB as base64 + JSON). */
  trpcBodyBytes: 22 * 1024 * 1024,
  /** Any other JSON endpoint. */
  defaultBodyBytes: 100 * 1024,
  /** Contract scans (PDF/JPEG/PNG) after base64 decoding. */
  scanBytes: 15 * 1024 * 1024,
  /** Excel workbooks after base64 decoding. */
  spreadsheetBytes: 5 * 1024 * 1024,
  /** Sum of the uncompressed parts of an .xlsx (zip) — protects against decompression bombs. */
  spreadsheetUnzippedBytes: 60 * 1024 * 1024,
  spreadsheetZipEntries: 2_000,
  spreadsheetMaxRatio: 200,
  spreadsheetRows: 5_000,
  spreadsheetColumns: 100,
  spreadsheetCellChars: 2_000,
  /** Rows accepted by one import call. */
  importRows: 2_000,
  /** IDs accepted by one bulk call. */
  bulkIds: 500,
  /** Money: decimal(12,2) columns; keep a wide safety margin. */
  maxAmount: 999_999_999.99,
  shortText: 255,
  longText: 5_000,
  fileName: 255,
  passwordMax: 256,
} as const;
