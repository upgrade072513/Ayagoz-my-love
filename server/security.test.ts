import { describe, expect, it } from "vitest";
import { isSafeStorageKey, isStorageAccessAllowed } from "./_core/storageProxy";
import { hashPassword, verifyPassword } from "./localAuth";

describe("storage key security", () => {
  it("accepts normal application storage keys", () => {
    expect(isSafeStorageKey("42/contracts/scan.pdf")).toBe(true);
  });

  it("rejects traversal and absolute storage keys", () => {
    expect(isSafeStorageKey("../private.pdf")).toBe(false);
    expect(isSafeStorageKey("42/../other/private.pdf")).toBe(false);
    expect(isSafeStorageKey("/private.pdf")).toBe(false);
    expect(isSafeStorageKey("42\\private.pdf")).toBe(false);
  });

  it("requires an authenticated user for storage access and blocks direct contract scans", () => {
    expect(isStorageAccessAllowed(null, "42/reports/report.pdf")).toBe(false);
    expect(isStorageAccessAllowed({ id: 42 }, "42/reports/report.pdf")).toBe(true);
    expect(isStorageAccessAllowed({ id: 42 }, "42/contracts/scan.pdf")).toBe(false);
  });

  it("hashes passwords and verifies only the matching password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).toMatch(/^scrypt\$/);
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
    expect(await verifyPassword("wrong password", encoded)).toBe(false);
    expect(encoded).not.toContain("correct horse");
  });

  it("does not persist plaintext password in the password hash", async () => {
    const encoded = await hashPassword("a sufficiently long password");
    expect(encoded).not.toContain("a sufficiently long password");
  });
});
