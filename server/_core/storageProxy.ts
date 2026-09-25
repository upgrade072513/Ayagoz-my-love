import type { Express } from "express";
import { ENV } from "./env";
import { authenticateLocalRequest } from "../localAuth";
import { diskPath, isDiskStorage } from "../storage";

export function isSafeStorageKey(key: string) {
  return Boolean(key) && !key.includes("..") && !key.includes("\\") && !key.startsWith("/");
}

export function isStorageAccessAllowed(user: unknown, key: string) {
  if (!user || !isSafeStorageKey(key)) return false;
  // Contract scans must go through documents.download, which checks the contract's department and document rules before decrypting.
  if (key.split("/").includes("contracts")) return false;
  return true;
}

export function registerStorageProxy(app: Express) {
  // Disk storage (STORAGE_DIR): same access rules, file is streamed from the volume.
  app.get("/files/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!isDiskStorage() || !key || !isSafeStorageKey(key)) {
      res.status(400).send("Invalid storage key");
      return;
    }
    if (key.split("/").includes("contracts")) {
      res.status(403).send("Protected document download required");
      return;
    }
    const user = await authenticateLocalRequest(req).catch(() => null);
    if (!isStorageAccessAllowed(user, key)) {
      res.status(401).send("Unauthorized");
      return;
    }
    res.set("Cache-Control", "no-store");
    res.sendFile(diskPath(key), error => {
      if (error && !res.headersSent) res.status(404).send("File not found");
    });
  });

  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    if (!isSafeStorageKey(key)) {
      res.status(400).send("Invalid storage key");
      return;
    }

    if (key.split("/").includes("contracts")) {
      res.status(403).send("Protected document download required");
      return;
    }

    try {
      const user = await authenticateLocalRequest(req);
      if (!isStorageAccessAllowed(user, key)) {
        res.status(key.split("/").includes("contracts") ? 403 : 401).send(key.split("/").includes("contracts") ? "Protected document download required" : "Unauthorized");
        return;
      }
    } catch {
      res.status(401).send("Unauthorized");
      return;
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
