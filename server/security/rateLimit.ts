// Fixed-window rate limiting stored in the database, so every app instance sees the same counters
// (an in-memory Map would reset on redeploy and be bypassable with several replicas).
// Falls back to process memory only when no database is configured (unit tests).
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

type Bucket = { count: number; resetAtMs: number };
const memory = new Map<string, Bucket>();

export type RateRule = { name: string; limit: number; windowMs: number };

/** Keys are hashed: no raw e-mail addresses or IPs end up in the table. */
export const rateKey = (rule: string, ...parts: Array<string | number>) =>
  `${rule}:${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 40)}`;

async function database() {
  try {
    return await getDb();
  } catch {
    return null; // unit tests with a mocked db module
  }
}

async function increment(
  key: string,
  windowMs: number,
  now = Date.now()
): Promise<Bucket> {
  const db = await database();
  const resetAtMs = now + windowMs;
  if (!db) {
    const current = memory.get(key);
    const next =
      !current || current.resetAtMs <= now
        ? { count: 1, resetAtMs }
        : { count: current.count + 1, resetAtMs: current.resetAtMs };
    memory.set(key, next);
    return next;
  }
  // Atomic upsert: a new window starts when the old one has expired. LAST_INSERT_ID(expr) hands this
  // connection the counter value produced by *its own* increment, so concurrent requests each get a
  // distinct number (no read-after-write race).
  const result: any = await db.execute(
    sql`INSERT INTO rateLimits (\`key\`, \`count\`, resetAtMs) VALUES (${key}, LAST_INSERT_ID(1), ${resetAtMs})
        ON DUPLICATE KEY UPDATE
          \`count\` = LAST_INSERT_ID(IF(resetAtMs <= ${now}, 1, \`count\` + 1)),
          resetAtMs = IF(resetAtMs <= ${now}, ${resetAtMs}, resetAtMs)`
  );
  const header = Array.isArray(result) ? result[0] : result;
  const count = Number(header?.insertId ?? 1) || 1;
  if (count === 1) return { count, resetAtMs };
  const rows: any = await db.execute(
    sql`SELECT resetAtMs FROM rateLimits WHERE \`key\` = ${key}`
  );
  const row = (Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0]) ?? {};
  return { count, resetAtMs: Number(row.resetAtMs) || now + windowMs };
}

/** Counts one attempt; returns false when the limit for the current window is exceeded. */
export async function consume(rule: RateRule, key: string) {
  const bucket = await increment(`${rule.name}|${key}`, rule.windowMs);
  return {
    allowed: bucket.count <= rule.limit,
    retryAfterMs: Math.max(0, bucket.resetAtMs - Date.now()),
  };
}

/** Current count without incrementing it (for counters that only count failures). */
export async function peek(rule: RateRule, key: string) {
  const full = `${rule.name}|${key}`;
  const now = Date.now();
  const db = await database();
  let bucket: Bucket | undefined;
  if (!db) bucket = memory.get(full);
  else {
    const rows: any = await db.execute(
      sql`SELECT \`count\`, resetAtMs FROM rateLimits WHERE \`key\` = ${full}`
    );
    const row = Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0];
    if (row)
      bucket = { count: Number(row.count), resetAtMs: Number(row.resetAtMs) };
  }
  const active = bucket && bucket.resetAtMs > now ? bucket : undefined;
  return {
    allowed: !active || active.count < rule.limit,
    retryAfterMs: active ? active.resetAtMs - now : 0,
  };
}

export async function reset(rule: RateRule, key: string) {
  const full = `${rule.name}|${key}`;
  memory.delete(full);
  const db = await database();
  if (db) await db.execute(sql`DELETE FROM rateLimits WHERE \`key\` = ${full}`);
}

/** tRPC helper: throws TOO_MANY_REQUESTS with a human message. */
export async function enforce(rule: RateRule, key: string, message?: string) {
  const result = await consume(rule, key);
  if (!result.allowed) {
    const minutes = Math.max(1, Math.ceil(result.retryAfterMs / 60000));
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        message ?? `Слишком много запросов. Попробуйте через ${minutes} мин.`,
    });
  }
}

export const RULES = {
  loginPerAccountAndIp: {
    name: "login-ip-email",
    limit: 8,
    windowMs: 15 * 60_000,
  },
  loginPerAccount: { name: "login-email", limit: 30, windowMs: 15 * 60_000 },
  loginPerIp: { name: "login-ip", limit: 100, windowMs: 15 * 60_000 },
  passwordChange: { name: "password-change", limit: 10, windowMs: 15 * 60_000 },
  scanRecognition: { name: "ocr", limit: 30, windowMs: 10 * 60_000 },
  spreadsheetParse: { name: "xlsx", limit: 40, windowMs: 10 * 60_000 },
  fileUpload: { name: "upload", limit: 120, windowMs: 10 * 60_000 },
  pdfRender: { name: "pdf", limit: 120, windowMs: 10 * 60_000 },
} satisfies Record<string, RateRule>;

export const _memoryForTests = memory;
