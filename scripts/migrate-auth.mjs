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

  console.log("[migrate-auth] schema is up to date");
} finally {
  await connection.end();
}
