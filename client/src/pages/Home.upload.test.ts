import { describe, expect, it } from "vitest";
import { areSimilarTenantNames, findContractDuplicates, formatUploadFileSize, isSupportedScanFile, parseContractIdentityFromFileName, shouldOpenNavigationContract, uploadProgressPercent } from "./Home";

describe("contract scan upload formats", () => {
  it("accepts PDF, JPG, and PNG files", () => {
    expect(isSupportedScanFile({ type: "application/pdf" })).toBe(true);
    expect(isSupportedScanFile({ type: "image/jpeg" })).toBe(true);
    expect(isSupportedScanFile({ type: "image/png" })).toBe(true);
  });

  it("rejects unsupported or missing files", () => {
    expect(isSupportedScanFile({ type: "application/msword" })).toBe(false);
    expect(isSupportedScanFile(undefined)).toBe(false);
  });
});

describe("batch contract filename identity", () => {
  it("extracts identity for each selected scan filename", () => {
    const files = ["A-101 от 01.08.2026.pdf", "B-202 from 2026-08-02.png"];
    expect(files.map(parseContractIdentityFromFileName)).toEqual([{ contractNumber: "A-101", contractDate: "2026-08-01" }, { contractNumber: "B-202", contractDate: "2026-08-02" }]);
  });
});

describe("smart upload queue", () => {
  it("formats file sizes and exposes meaningful processing progress", () => {
    expect(formatUploadFileSize(640)).toBe("640 Б");
    expect(formatUploadFileSize(2 * 1024 * 1024)).toBe("2.0 МБ");
    expect(uploadProgressPercent("waiting")).toBe(8);
    expect(uploadProgressPercent("processing")).toBe(55);
    expect(uploadProgressPercent("ready")).toBe(100);
    expect(uploadProgressPercent("error")).toBe(100);
  });

  it("detects duplicates by contract number and tenant name", () => {
    const existing = [{ id: 1, contractNumber: "Д-101", tenantName: "Анна Петрова" }, { id: 2, contractNumber: "Д-202", tenantName: "Борис" }];
    expect(findContractDuplicates({ contractNumber: "д-101", tenantName: "Новый арендатор" }, existing)[0]?.matchedBy).toEqual(["contractNumber"]);
    expect(findContractDuplicates({ contractNumber: "Д-999", tenantName: "анна петрова" }, existing)[0]?.matchedBy).toEqual(["tenantName"]);
    expect(findContractDuplicates({ contractNumber: "Д-101", tenantName: "Анна Петрова" }, existing)[0]?.matchedBy).toEqual(["contractNumber", "tenantName"]);
    expect(findContractDuplicates({ contractNumber: "Д-404", tenantName: "Вера" }, existing)).toEqual([]);
  });

  it("finds likely tenant-name duplicates with minor typos", () => {
    expect(areSimilarTenantNames("анна петрова", "анна петрва")).toBe(true);
    expect(areSimilarTenantNames("анна петрова", "борис")).toBe(false);
    expect(findContractDuplicates({ contractNumber: "Д-999", tenantName: "Анна Петрва" }, [{ id: 4, contractNumber: "Д-004", tenantName: "Анна Петрова" }])[0]?.matchedBy).toEqual(["tenantName"]);
  });
});


describe("contract navigation", () => {
  it("opens a navigation target once and does not reopen it after list invalidation", () => {
    expect(shouldOpenNavigationContract(42, null)).toBe(true);
    expect(shouldOpenNavigationContract(42, 42)).toBe(false);
    expect(shouldOpenNavigationContract(43, 42)).toBe(true);
    expect(shouldOpenNavigationContract(null, 42)).toBe(false);
  });
});
