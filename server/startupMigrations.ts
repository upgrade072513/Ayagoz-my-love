// Schema steps the app needs, applied by the server itself at start-up.
// Normally scripts/migrate-auth.mjs does this in Railway's pre-deploy step; if that step does not
// run (service settings, manual restarts), the app still brings its own schema up to date.
// Every step is idempotent and failures are logged, never fatal.
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Conn = mysql.Connection;

async function indexExists(conn: Conn, table: string, name: string) {
  const [rows]: any = await conn.query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
    [table, name]
  );
  return rows.length > 0;
}

async function step(name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    console.error(
      `[startup-migrations] ${name} failed:`,
      (error as Error)?.message ?? error
    );
  }
}

const RESET_MARKER = "data_reset_accruals_2026_09_28";

export async function runStartupMigrations(url = process.env.DATABASE_URL) {
  if (!url) return;
  let conn: Conn | null = null;
  try {
    conn = await mysql.createConnection(url);
  } catch (error) {
    console.error(
      "[startup-migrations] cannot connect:",
      (error as Error)?.message ?? error
    );
    return;
  }
  const c = conn;
  try {
    const [[{ db }]]: any = await c.query("SELECT DATABASE() AS db");
    if (!db || /^(sys|mysql|information_schema|performance_schema|metrics_schema)$/i.test(db)) {
      console.error(
        `[startup-migrations] DATABASE_URL points to the system database "${db ?? ""}". ` +
          "Put your own database name after the port, e.g. ...:4000/test?ssl=... — nothing was changed."
      );
      return;
    }
    let createdSchema = false;
    await step("initial schema", async () => {
      const [rows]: any = await c.query(
        "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' LIMIT 1"
      );
      if (rows.length) return;
      const folder = path.resolve(process.cwd(), "drizzle");
      if (!fs.existsSync(path.join(folder, "meta", "_journal.json")))
        throw new Error(`migrations folder not found: ${folder}`);
      console.log(`[startup-migrations] database ${db} is empty, creating the schema…`);
      await migrate(drizzle(c), { migrationsFolder: folder });
      createdSchema = true;
      console.log("[startup-migrations] schema created");
    });
    await step("rateLimits table", async () => {
      await c.query(
        "CREATE TABLE IF NOT EXISTS `rateLimits` (`key` varchar(128) NOT NULL, `count` int NOT NULL DEFAULT 0, `resetAtMs` bigint NOT NULL, CONSTRAINT `rateLimits_key` PRIMARY KEY(`key`))"
      );
    });
    await step("contracts.tariffSchedule column", async () => {
      const [rows]: any = await c.query(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts' AND COLUMN_NAME = 'tariffSchedule' LIMIT 1"
      );
      if (!rows.length)
        await c.query("ALTER TABLE `contracts` ADD `tariffSchedule` text NULL");
    });
    // One-time owner-requested reset (28.09.2026): all accruals, invoices and payments.
    await step("one-time accruals reset", async () => {
      const [done]: any = await c.query(
        "SELECT id FROM securityAuditLog WHERE eventType = ? LIMIT 1",
        [RESET_MARKER]
      );
      if (done.length) return;
      await c.beginTransaction();
      try {
        const counts: Record<string, number> = {};
        for (const table of [
          "paymentAudit",
          "payments",
          "invoiceItems",
          "invoices",
          "accruals",
        ]) {
          const [result]: any = await c.query(`DELETE FROM \`${table}\``);
          counts[table] = result.affectedRows;
        }
        await c.query(
          "INSERT INTO securityAuditLog (eventType, actorUserId, targetUserId, oldValue, newValue) VALUES (?, NULL, NULL, ?, ?)",
          [
            RESET_MARKER,
            JSON.stringify(counts),
            "all accruals, invoices and payments removed (owner request)",
          ]
        );
        await c.commit();
        console.log(
          "[startup-migrations] one-time reset removed:",
          JSON.stringify(counts)
        );
      } catch (error) {
        await c.rollback().catch(() => undefined);
        throw error;
      }
    });
    await step("invoiceItems.accrualId unique", async () => {
      if (await indexExists(c, "invoiceItems", "invoiceItems_accrualId_unique"))
        return;
      const [dups]: any = await c.query(
        "SELECT accrualId FROM `invoiceItems` GROUP BY accrualId HAVING COUNT(*) > 1 LIMIT 1"
      );
      if (dups.length)
        return console.warn(
          "[startup-migrations] duplicate invoice lines exist; unique index not added"
        );
      await c.query(
        "ALTER TABLE `invoiceItems` ADD CONSTRAINT `invoiceItems_accrualId_unique` UNIQUE(`accrualId`)"
      );
    });
    await step("accruals contract+period unique", async () => {
      if (await indexExists(c, "accruals", "accruals_contract_period_unique"))
        return;
      const [dups]: any = await c.query(
        "SELECT contractId FROM `accruals` WHERE contractId IS NOT NULL GROUP BY contractId, period HAVING COUNT(*) > 1 LIMIT 1"
      );
      if (dups.length)
        return console.warn(
          "[startup-migrations] duplicate accruals exist; unique index not added"
        );
      await c.query(
        "ALTER TABLE `accruals` ADD CONSTRAINT `accruals_contract_period_unique` UNIQUE(`contractId`,`period`)"
      );
    });
    console.log("[startup-migrations] schema is up to date");
    const script = path.resolve(process.cwd(), "scripts", "ensure-admin.mjs");
    if (createdSchema && process.env.ADMIN_EMAIL && fs.existsSync(script))
      await new Promise<void>(resolve =>
        execFile(process.execPath, [script], { env: process.env }, (error, stdout, stderr) => {
          if (stdout) process.stdout.write(stdout);
          if (stderr) process.stderr.write(stderr);
          if (error) console.error("[startup-migrations] ensure-admin failed:", error.message);
          resolve();
        })
      );
  } finally {
    await c.end().catch(() => undefined);
  }
}
