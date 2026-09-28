import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diskPath, storagePut, storageRead } from "./storage";

describe("disk storage (Railway volume)", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vol-"));
    vi.stubEnv("STORAGE_DIR", "");
    vi.stubEnv("RAILWAY_VOLUME_MOUNT_PATH", dir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores and reads files from the attached volume", async () => {
    const { key, url } = await storagePut(
      "1/contracts/7/scan.pdf.enc",
      Buffer.from("encrypted bytes")
    );
    expect(url).toBe(`/files/${key}`);
    expect((await storageRead(key)).toString()).toBe("encrypted bytes");
  });

  it("refuses keys that escape the storage directory", () => {
    expect(() => diskPath("../../etc/passwd")).toThrow("Invalid storage key");
  });

  it("explains a missing file instead of crashing", async () => {
    await expect(storageRead("1/contracts/7/missing.enc")).rejects.toThrow(
      "Загрузите скан заново"
    );
  });
});
