import { describe, expect, it } from "vitest";
import {
  BATCH_SCAN_CONCURRENCY,
  MAX_BATCH_SCAN_FILES,
  buildBulkContractFields,
  uploadProgressPercent,
  validateBulkScanPreview,
} from "./Home";

describe("bulk contract scan helpers", () => {
  it("allows a batch of at least 20 files and keeps OCR work bounded", () => {
    expect(MAX_BATCH_SCAN_FILES).toBeGreaterThanOrEqual(20);
    expect(BATCH_SCAN_CONCURRENCY).toBeGreaterThan(1);
    expect(uploadProgressPercent("saving")).toBe(82);
  });

  it("builds server-compatible contract fields from OCR preview", () => {
    expect(buildBulkContractFields({
      contractNumber: "  Д-101 ",
      contractDate: "2026-08-01T00:00:00.000Z",
      tenantName: " Анна Петрова ",
      propertyName: "Астана",
      unitName: "12",
      startDate: "2026-08-01",
      endDate: "2026-12-31",
      tariffType: "monthly",
      tariffAmount: "125000 ₸",
      status: "active",
    })).toMatchObject({
      contractNumber: "Д-101",
      contractDate: "2026-08-01",
      tenantName: "Анна Петрова",
      propertyName: "Астана",
      unitName: "12",
      startDate: "2026-08-01",
      endDate: "2026-12-31",
      tariffType: "monthly",
      tariffAmount: 125000,
      status: "active",
    });
  });

  it("blocks bulk save when required OCR data is missing", () => {
    expect(validateBulkScanPreview({
      tenantName: "",
      propertyName: "Астана",
      startDate: "2026-08-01",
      endDate: "2026-12-31",
      tariffType: "monthly",
      tariffAmount: 125000,
      status: "active",
    })).toBe("Не распознан плательщик / арендатор");

    expect(validateBulkScanPreview({
      tenantName: "Анна",
      propertyName: "Астана",
      startDate: "2026-08-01",
      endDate: "2026-12-31",
      tariffType: "monthly",
      tariffAmount: 0,
      status: "active",
    })).toBe("Не распознана ставка");
  });
});
