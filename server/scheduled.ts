import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { archiveExpiredContracts } from "./db";
import { ENV } from "./_core/env";

function matchesSecret(candidate: string, expected: string) {
  if (!candidate || !expected) return false;
  const left = createHash("sha256").update(candidate).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function archiveExpiredContractsHandler(req: Request, res: Response) {
  try {
    const candidate = String(req.headers["x-scheduled-secret"] ?? "");
    if (!matchesSecret(candidate, ENV.scheduledSecret)) return res.status(403).json({ error: "cron-only" });
    const result = await archiveExpiredContracts();
    return res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message, stack: error instanceof Error ? error.stack : undefined, timestamp: new Date().toISOString() });
  }
}
