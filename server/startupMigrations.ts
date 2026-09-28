// Schema steps the app needs, applied by the server itself at start-up.
// Normally scripts/migrate-auth.mjs does this in Railway's pre-deploy step; if that step does not
// run (service settings, manual restarts), the app still brings its own schema up to date.
// Every step is idempotent and failures are logged, never fatal.
import mysql from "mysql2/promise";

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
  } finally {
    await c.end().catch(() => undefined);
  }
}
