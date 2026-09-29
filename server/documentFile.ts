// GET /api/documents/:id/file — the stored scan as a plain binary response (inline for the viewer,
// ?download=1 as an attachment). Much lighter than base64 inside JSON and lets the browser stream
// and show large PDFs natively.
import type { Express } from "express";
import { requireDocumentAccess } from "./authz";
import { decryptContractFile } from "./fileCrypto";
import { authenticateLocalRequest } from "./localAuth";
import { consume, rateKey, RULES } from "./security/rateLimit";
import { storageRead } from "./storage";

const SAFE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export function registerDocumentFileRoute(app: Express) {
  app.get("/api/documents/:id/file", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const user = await authenticateLocalRequest(req).catch(() => null);
      if (!user) return res.status(401).type("text/plain").send("Войдите в систему заново");
      if (user.mustChangePassword)
        return res.status(403).type("text/plain").send("Сначала замените временный пароль");
      if (!/^[1-9]\d{0,9}$/.test(String(req.params.id)))
        return res.status(400).type("text/plain").send("Некорректный номер документа");
      const limit = await consume(RULES.pdfRender, rateKey("user", user.id));
      if (!limit.allowed)
        return res.status(429).type("text/plain").send("Слишком много запросов, попробуйте через минуту");
      let document;
      try {
        ({ document } = await requireDocumentAccess(user, Number(req.params.id), "view"));
      } catch (error) {
        return (error as any)?.code === "NOT_FOUND"
          ? res.status(404).type("text/plain").send("Документ не найден")
          : res.status(403).type("text/plain").send("Нет доступа к документу");
      }
      let stored: Buffer;
      try {
        stored = await storageRead(document.fileKey);
      } catch (error) {
        console.error(`[document-file] read failed for document ${document.id} (${document.fileKey}):`, (error as Error)?.message ?? error);
        return res
          .status(404)
          .type("text/plain")
          .send("Файл скана не найден в хранилище — загрузите скан заново.");
      }
      let data = stored;
      if (document.encryptionVersion > 0 && document.encryptionIv && document.encryptionAuthTag) {
        try {
          data = decryptContractFile(stored, {
            version: document.encryptionVersion,
            iv: document.encryptionIv,
            authTag: document.encryptionAuthTag,
          });
        } catch (error) {
          console.error(`[document-file] decrypt failed for document ${document.id}:`, (error as Error)?.message ?? error);
          return res
            .status(500)
            .type("text/plain")
            .send("Не удалось расшифровать скан: проверьте ключ шифрования CONTRACT_FILE_ENCRYPTION_KEY в настройках сервера.");
        }
      }
      const type = SAFE_TYPES.has(document.mimeType) ? document.mimeType : "application/octet-stream";
      const inline = !req.query.download && type !== "application/octet-stream";
      const ascii = document.fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "scan";
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Length", String(data.length));
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`
      );
      res.end(data);
    } catch (error) {
      console.error("[document-file]", error);
      if (!res.headersSent) res.status(500).type("text/plain").send("Не удалось открыть скан");
    }
  });
}
