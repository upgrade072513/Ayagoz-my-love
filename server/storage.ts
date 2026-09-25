// File storage with two backends:
//  - disk  (STORAGE_DIR, or an attached Railway volume): files live on the server's disk.
//  - forge (legacy Manus Forge storage via BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY).
// Contract scans are encrypted before they reach either backend (see fileCrypto.ts).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENV } from "./_core/env";

export const DISK_URL_PREFIX = "/files/";
const LEGACY_URL_PREFIX = "/manus-storage/";

// On Railway an attached volume is used automatically (RAILWAY_VOLUME_MOUNT_PATH).
export const storageDir = () => (process.env.STORAGE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "").trim();
export const isDiskStorage = () => Boolean(storageDir());

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

/** Absolute path of a key inside STORAGE_DIR; refuses anything that would escape it. */
export function diskPath(key: string) {
  const root = path.resolve(storageDir());
  const full = path.resolve(root, normalizeKey(key));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
  return full;
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;
  if (!forgeUrl || !forgeKey) {
    throw new Error("Хранилище файлов не настроено: подключите Volume в Railway (или задайте STORAGE_DIR)");
  }
  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

async function forgePresign(kind: "get" | "put", key: string) {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const url = new URL(`v1/storage/presign/${kind}`, forgeUrl + "/");
  url.searchParams.set("path", key);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${forgeKey}` } });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage presign failed (${resp.status}): ${msg}`);
  }
  const { url: signed } = (await resp.json()) as { url: string };
  if (!signed) throw new Error("Storage returned empty presign URL");
  return signed;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

  if (isDiskStorage()) {
    const file = diskPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return { key, url: `${DISK_URL_PREFIX}${key}` };
  }

  const uploadResp = await fetch(await forgePresign("put", key), {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Blob([bytes], { type: contentType }),
  });
  if (!uploadResp.ok) throw new Error(`Storage upload failed (${uploadResp.status})`);
  return { key, url: `${LEGACY_URL_PREFIX}${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `${isDiskStorage() ? DISK_URL_PREFIX : LEGACY_URL_PREFIX}${key}` };
}

/** Reads the stored bytes of a file. */
export async function storageRead(relKey: string): Promise<Buffer> {
  const key = normalizeKey(relKey);
  if (isDiskStorage()) {
    try {
      return await readFile(diskPath(key));
    } catch {
      throw new Error("Файл не найден в хранилище. Загрузите скан заново.");
    }
  }
  const response = await fetch(await forgePresign("get", key));
  if (!response.ok) throw new Error("Не удалось получить файл документа");
  return Buffer.from(await response.arrayBuffer());
}

/** Legacy helper (forge only): a short-lived download URL. */
export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return forgePresign("get", normalizeKey(relKey));
}
