// Guarantees that the owner's account exists and is an active administrator.
//
// Runs on every deploy (see railway.json). Does nothing unless ADMIN_EMAIL is set.
//   ADMIN_EMAIL=owner@example.com            -> account is created if missing, role forced to admin,
//                                               status forced to active. A one-time password is issued
//                                               ONLY if the account has no password yet.
//   ADMIN_RESET_PASSWORD=true (optional)      -> additionally issues a fresh one-time password
//                                               (use if the admin forgot the password; remove afterwards).
// A one-time password is printed once to the deploy log and must be changed at first sign-in.
import "dotenv/config";
import { randomBytes, randomInt, scrypt as nodeScrypt } from "node:crypto";
import mysql from "mysql2/promise";

const rawEmail = (process.env.ADMIN_EMAIL ?? "").trim();
if (!rawEmail) {
  console.log("[ensure-admin] ADMIN_EMAIL is not set, skipping");
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error("[ensure-admin] DATABASE_URL is not set");
  process.exit(1);
}
const email = rawEmail.toLowerCase();
const forceReset = String(process.env.ADMIN_RESET_PASSWORD ?? "").trim().toLowerCase() === "true";
const TEMP_TTL_MS = 1000 * 60 * 60 * 24 * 3;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

// Must stay identical to server/localAuth.ts (hashPassword / generateTemporaryPassword).
const scrypt = (password, salt) => new Promise((resolve, reject) => nodeScrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (e, key) => (e ? reject(e) : resolve(key))));
const hashPassword = async password => { const salt = randomBytes(16); return `scrypt$${salt.toString("hex")}$${(await scrypt(password, salt)).toString("hex")}`; };
const temporaryPassword = () => Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const audit = (eventType, targetUserId, oldValue, newValue) =>
  connection.query("INSERT INTO securityAuditLog (eventType, actorUserId, targetUserId, oldValue, newValue) VALUES (?, NULL, ?, ?, ?)", [eventType, targetUserId, oldValue, newValue]);
const announce = (password, expiresAt) => {
  console.log("[ensure-admin] ================================================");
  console.log(`[ensure-admin] Login:              ${rawEmail}`);
  console.log(`[ensure-admin] One-time password:  ${password}`);
  console.log(`[ensure-admin] Valid until:        ${expiresAt.toISOString()} (UTC)`);
  console.log("[ensure-admin] You will be asked to set your own password at first sign-in.");
  console.log("[ensure-admin] ================================================");
};

try {
  const [rows] = await connection.query("SELECT id, role, accountStatus, passwordHash, emailNormalized FROM users WHERE emailNormalized = ? OR LOWER(TRIM(email)) = ? ORDER BY id LIMIT 1", [email, email]);
  const user = rows[0];

  if (!user) {
    const password = temporaryPassword();
    const expiresAt = new Date(Date.now() + TEMP_TTL_MS);
    const [result] = await connection.query(
      "INSERT INTO users (name, email, emailNormalized, passwordHash, accountStatus, loginMethod, role, mustChangePassword, temporaryPasswordExpiresAt, passwordChangedAt) VALUES (?, ?, ?, ?, 'active', 'local', 'admin', true, ?, NOW())",
      [rawEmail.split("@")[0], rawEmail, email, await hashPassword(password), expiresAt]
    );
    await audit("admin_bootstrap_created", result.insertId, "none", "admin; one-time password issued");
    console.log(`[ensure-admin] created administrator #${result.insertId}`);
    announce(password, expiresAt);
  } else {
    const changes = [];
    if (user.role !== "admin") changes.push(`role ${user.role} -> admin`);
    if (user.accountStatus !== "active") changes.push(`status ${user.accountStatus} -> active`);
    if (user.emailNormalized !== email) changes.push("emailNormalized fixed");
    if (changes.length) {
      await connection.query("UPDATE users SET role = 'admin', accountStatus = 'active', emailNormalized = ? WHERE id = ?", [email, user.id]);
      await audit("admin_bootstrap_access", user.id, `${user.role}/${user.accountStatus}`, "admin/active");
      console.log(`[ensure-admin] user #${user.id}: ${changes.join(", ")}`);
    } else {
      console.log(`[ensure-admin] user #${user.id} is already an active administrator`);
    }
    if (!user.passwordHash || forceReset) {
      const password = temporaryPassword();
      const expiresAt = new Date(Date.now() + TEMP_TTL_MS);
      await connection.query("UPDATE users SET passwordHash = ?, mustChangePassword = true, temporaryPasswordExpiresAt = ?, passwordChangedAt = NOW(), loginMethod = 'local' WHERE id = ?", [await hashPassword(password), expiresAt, user.id]);
      await connection.query("UPDATE authSessions SET revokedAt = NOW() WHERE userId = ? AND revokedAt IS NULL", [user.id]);
      await audit("admin_bootstrap_password", user.id, user.passwordHash ? "password reset requested" : "no password", "one-time password issued");
      announce(password, expiresAt);
      if (forceReset) console.log("[ensure-admin] Remove ADMIN_RESET_PASSWORD now, otherwise every deploy issues a new password.");
    } else {
      console.log("[ensure-admin] existing password kept (set ADMIN_RESET_PASSWORD=true to issue a one-time password)");
    }
  }
} finally {
  await connection.end();
}
