// Removes records of contract scans that were stored in the old Manus storage.
// They were encrypted with a key that stayed in Manus, so they cannot be opened any more;
// contracts, accruals and invoices are NOT touched. Scans are re-uploaded by users afterwards.
//
// Runs on every deploy (railway.json) but only acts when disk storage is active
// (STORAGE_DIR or an attached Railway volume) and only on rows pointing to /manus-storage/.
// New uploads use /files/..., so they are never affected. Safe to re-run.
import "dotenv/config";
import mysql from "mysql2/promise";

const storageDir = (process.env.STORAGE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "").trim();
if (!storageDir) {
  console.log("[cleanup-scans] disk storage is not configured, skipping");
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error("[cleanup-scans] DATABASE_URL is not set");
  process.exit(1);
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await connection.query("SELECT id, contractId FROM documents WHERE fileUrl LIKE '/manus-storage/%'");
  if (!rows.length) {
    console.log("[cleanup-scans] no legacy scan records");
  } else {
    const ids = rows.map(row => row.id);
    const contracts = new Set(rows.map(row => row.contractId));
    await connection.beginTransaction();
    await connection.query("DELETE FROM documentPermissions WHERE documentId IN (?)", [ids]);
    await connection.query("DELETE FROM documents WHERE id IN (?)", [ids]);
    await connection.query(
      "INSERT INTO securityAuditLog (eventType, actorUserId, targetUserId, oldValue, newValue) VALUES ('legacy_scans_removed', NULL, NULL, ?, 'removed; re-upload after migration')",
      [`${ids.length} scan record(s) in ${contracts.size} contract(s)`]
    );
    await connection.commit();
    console.log(`[cleanup-scans] removed ${ids.length} legacy scan record(s) from ${contracts.size} contract(s); contracts kept`);
  }
} catch (error) {
  await connection.rollback().catch(() => undefined);
  throw error;
} finally {
  await connection.end();
}
