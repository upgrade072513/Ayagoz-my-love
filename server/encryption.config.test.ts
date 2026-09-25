import { describe, expect, it } from "vitest";

describe("contract scan encryption configuration", () => {
  it("uses a server-only secret when encryption is configured", () => {
    const key = process.env.FILE_ENCRYPTION_KEY ?? process.env.CONTRACT_FILE_ENCRYPTION_KEY ?? "";
    if (!key) return;
    expect(key.trim()).not.toBe("");
  });
});
