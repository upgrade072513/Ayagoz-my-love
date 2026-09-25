import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptContractFile, encryptContractFile } from "./fileCrypto";

describe("contract file encryption", () => {
  beforeEach(() => vi.stubEnv("FILE_ENCRYPTION_KEY", "test-contract-file-key-with-at-least-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips PDF bytes and keeps metadata separate", () => {
    const original = Buffer.from("%PDF-1.7 confidential contract content", "utf8");
    const encrypted = encryptContractFile(original);
    expect(encrypted.version).toBe(1);
    expect(encrypted.iv).toHaveLength(24);
    expect(encrypted.authTag).toHaveLength(32);
    expect(encrypted.data.equals(original)).toBe(false);
    expect(decryptContractFile(encrypted.data, encrypted)).toEqual(original);
  });

  it("rejects tampered encrypted content", () => {
    const encrypted = encryptContractFile(Buffer.from("private document", "utf8"));
    encrypted.data[0] ^= 1;
    expect(() => decryptContractFile(encrypted.data, encrypted)).toThrow();
  });
});
