// Idempotent schema update for local auth (migrations 0021 + 0022):
//  - adds users.mustChangePassword / users.temporaryPasswordExpiresAt (one-time passwords)
//  - drops users.openId (legacy Manus OAuth identifier)
// Safe to run on every deploy: each step checks the current schema first.
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate-auth] DATABASE_URL is not set");
  process.exit(1);
}

const connection = await mysql.createConnection(url);
try {
  const [[{ db }]] = await connection.query("SELECT DATABASE() AS db");
  const columns = async () => {
    const [rows] = await connection.query(
      "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'",
      [db]
    );
    return new Set(rows.map(row => row.name));
  };
  const indexes = async () => {
    const [rows] = await connection.query(
      "SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'",
      [db]
    );
    return new Set(rows.map(row => row.name));
  };

  let existing = await columns();
  if (!existing.size) throw new Error(`Table users not found in database ${db}`);

  if (!existing.has("mustChangePassword")) {
    await connection.query("ALTER TABLE `users` ADD `mustChangePassword` boolean DEFAULT false NOT NULL");
    console.log("[migrate-auth] added users.mustChangePassword");
  }
  if (!existing.has("temporaryPasswordExpiresAt")) {
    await connection.query("ALTER TABLE `users` ADD `temporaryPasswordExpiresAt` timestamp NULL");
    console.log("[migrate-auth] added users.temporaryPasswordExpiresAt");
  }

  existing = await columns();
  if (existing.has("openId")) {
    if ((await indexes()).has("users_openId_unique")) {
      await connection.query("ALTER TABLE `users` DROP INDEX `users_openId_unique`");
    }
    await connection.query("ALTER TABLE `users` DROP COLUMN `openId`");
    console.log("[migrate-auth] dropped legacy users.openId (Manus OAuth)");
  }

  // --- Security hardening (0023) --------------------------------------------------------
  // Shared rate-limit counters (login throttling works across several app instances).
  await connection.query(
    "CREATE TABLE IF NOT EXISTS `rateLimits` (`key` varchar(128) NOT NULL, `count` int NOT NULL DEFAULT 0, `resetAtMs` bigint NOT NULL, CONSTRAINT `rateLimits_key` PRIMARY KEY(`key`))"
  );
  // One accrual may be billed only once. Added only when existing data allows it.
  const [itemIndexes] = await connection.query(
    "SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'invoiceItems'",
    [db]
  );
  if (!itemIndexes.some(row => row.name === "invoiceItems_accrualId_unique")) {
    const [duplicates] = await connection.query(
      "SELECT accrualId, COUNT(*) AS n FROM `invoiceItems` GROUP BY accrualId HAVING n > 1 LIMIT 20"
    );
    if (duplicates.length) {
      console.warn(
        "[migrate-auth] WARNING: some accruals are billed in more than one invoice; unique index not added. Accrual ids:",
        duplicates.map(row => row.accrualId).join(", ")
      );
    } else {
      await connection.query(
        "ALTER TABLE `invoiceItems` ADD CONSTRAINT `invoiceItems_accrualId_unique` UNIQUE(`accrualId`)"
      );
      console.log("[migrate-auth] added unique index invoiceItems.accrualId");
    }
  }
  // One accrual per contract and month (prevents double billing through duplicates).
  const [accrualIndexes] = await connection.query(
    "SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'accruals'",
    [db]
  );
  if (!accrualIndexes.some(row => row.name === "accruals_contract_period_unique")) {
    const [duplicates] = await connection.query(
      "SELECT contractId, period, COUNT(*) AS n FROM `accruals` WHERE contractId IS NOT NULL GROUP BY contractId, period HAVING n > 1 LIMIT 20"
    );
    if (duplicates.length) {
      console.warn(
        "[migrate-auth] WARNING: duplicate accruals for the same contract and month; unique index not added:",
        duplicates.map(row => `${row.contractId}/${row.period}`).join(", ")
      );
    } else {
      await connection.query(
        "ALTER TABLE `accruals` ADD CONSTRAINT `accruals_contract_period_unique` UNIQUE(`contractId`,`period`)"
      );
      console.log("[migrate-auth] added unique index accruals(contractId, period)");
    }
  }
  const [scheduleColumn] = await connection.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'contracts' AND COLUMN_NAME = 'tariffSchedule' LIMIT 1",
    [db]
  );
  if (!scheduleColumn.length) {
    await connection.query("ALTER TABLE `contracts` ADD `tariffSchedule` text NULL");
    console.log("[migrate-auth] added contracts.tariffSchedule");
  }
  // Expired sessions are useless; keep the table small.
  await connection.query("DELETE FROM `authSessions` WHERE `expiresAt` < NOW() - INTERVAL 30 DAY");
  await connection.query("DELETE FROM `rateLimits` WHERE `resetAtMs` < ?", [Date.now() - 24 * 3600 * 1000]);

  console.log("[migrate-auth] schema is up to date");
} finally {
  await connection.end();
}
