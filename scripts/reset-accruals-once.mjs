// ONE-TIME data reset requested by the owner on 28.09.2026:
// removes ALL accruals, invoices, invoice lines, payments and payment history, so accruals can be
// made again from scratch with the new "Сделать начисление за выбранный месяц" button.
// Runs from db:predeploy, but only once per database: a marker is written to securityAuditLog.
// Contracts, documents (scans), users and folders are NOT touched.
import "dotenv/config";
import mysql from "mysql2/promise";

const MARKER = "data_reset_accruals_2026_09_28";
const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[reset-accruals] DATABASE_URL is not set, skipping");
  process.exit(0);
}

const connection = await mysql.createConnection(url);
try {
  const [done] = await connection.query(
    "SELECT id FROM securityAuditLog WHERE eventType = ? LIMIT 1",
    [MARKER]
  );
  if (done.length) {
    console.log("[reset-accruals] already done earlier, nothing to do");
  } else {
    await connection.beginTransaction();
    const counts = {};
    for (const table of ["paymentAudit", "payments", "invoiceItems", "invoices", "accruals"]) {
      const [result] = await connection.query(`DELETE FROM \`${table}\``);
      counts[table] = result.affectedRows;
    }
    await connection.query(
      "INSERT INTO securityAuditLog (eventType, actorUserId, targetUserId, oldValue, newValue) VALUES (?, NULL, NULL, ?, ?)",
      [MARKER, JSON.stringify(counts), "all accruals, invoices and payments removed (owner request)"]
    );
    await connection.commit();
    console.log("[reset-accruals] removed:", JSON.stringify(counts));
  }
} catch (error) {
  await connection.rollback().catch(() => undefined);
  throw error;
} finally {
  await connection.end();
}
