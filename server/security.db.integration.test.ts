// Race conditions can only be tested against a real database (row locks, transactions).
// Runs when SECURITY_TEST_DATABASE_URL points to a disposable MySQL/MariaDB/TiDB database whose schema
// was created from drizzle/*.sql (+ scripts/migrate-auth.mjs). Skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";

const url = process.env.SECURITY_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("database-level financial integrity", () => {
  let connection: mysql.Connection;
  let db: typeof import("./db");
  let rate: typeof import("./security/rateLimit");

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    connection = await mysql.createConnection(url!);
    for (const table of [
      "payments",
      "paymentAudit",
      "invoiceItems",
      "invoices",
      "accruals",
      "rateLimits",
    ])
      await connection.query(`DELETE FROM \`${table}\``);
    db = await import("./db");
    rate = await import("./security/rateLimit");
  });
  afterAll(async () => {
    await connection?.end();
  });

  async function draftAccrual(amount: string) {
    return db.createAccrual({
      contractId: null,
      period: "2026-09",
      serviceFrom: new Date("2026-09-01T00:00:00Z"),
      serviceTo: new Date("2026-09-30T00:00:00Z"),
      quantity: "1.00",
      amount,
      tenantName: "Race Test",
      propertyName: "Блок 38",
      status: "draft",
    });
  }

  it("11. concurrent payments cannot overpay an invoice", async () => {
    const accrual = await draftAccrual("1000.00");
    const invoice = await db.createInvoice(
      {
        invoiceNumber: `INV-RACE-${Date.now()}`,
        issueDate: new Date(),
        period: "2026-09",
        tenantName: "Race Test",
        totalAmount: "0.00",
        status: "issued",
      },
      [
        {
          invoiceId: 0,
          accrualId: accrual.id,
          description: "race",
          amount: "1000.00",
        },
      ]
    );
    expect(invoice.totalAmount).toBe("1000.00"); // recomputed from the locked accruals
    // 10 simultaneous payments of 400: at most two fit into 1000.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        db.recordPayment(
          {
            invoiceId: invoice.id,
            amount: "400.00",
            paidAt: new Date("2026-09-05T00:00:00Z"),
            method: "bank",
            reference: `R-${i}`,
          },
          1
        )
      )
    );
    const ok = results.filter(r => r.status === "fulfilled").length;
    expect(ok).toBe(2);
    const [[{ paid }]]: any = await connection.query(
      "SELECT SUM(amount) AS paid FROM payments WHERE invoiceId = ? AND status = 'posted'",
      [invoice.id]
    );
    expect(Number(paid)).toBeLessThanOrEqual(1000);
    const [[row]]: any = await connection.query(
      "SELECT paymentStatus FROM invoices WHERE id = ?",
      [invoice.id]
    );
    expect(row.paymentStatus).toBe("partially_paid");
  });

  it("a replayed reversal changes nothing the second time", async () => {
    const accrual = await draftAccrual("500.00");
    const invoice = await db.createInvoice(
      {
        invoiceNumber: `INV-REV-${Date.now()}`,
        issueDate: new Date(),
        period: "2026-09",
        tenantName: "Race Test",
        totalAmount: "0.00",
        status: "issued",
      },
      [
        {
          invoiceId: 0,
          accrualId: accrual.id,
          description: "rev",
          amount: "500.00",
        },
      ]
    );
    const payment = await db.recordPayment(
      {
        invoiceId: invoice.id,
        amount: "500.00",
        paidAt: new Date("2026-09-05T00:00:00Z"),
        method: "bank",
      },
      1
    );
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => db.reversePayment(payment.id, 1))
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const [audit]: any = await connection.query(
      "SELECT COUNT(*) AS n FROM paymentAudit WHERE paymentId = ? AND action = 'reversed'",
      [payment.id]
    );
    expect(Number(audit[0].n)).toBe(1);
  });

  it("the same accrual cannot be billed by two concurrent invoices", async () => {
    const accrual = await draftAccrual("700.00");
    const attempts = await Promise.allSettled(
      [1, 2, 3, 4].map(i =>
        db.createInvoice(
          {
            invoiceNumber: `INV-DUP-${Date.now()}-${i}`,
            issueDate: new Date(),
            period: "2026-09",
            tenantName: "Race Test",
            totalAmount: "0.00",
            status: "issued",
          },
          [
            {
              invoiceId: 0,
              accrualId: accrual.id,
              description: "dup",
              amount: "700.00",
            },
          ]
        )
      )
    );
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const [[{ n }]]: any = await connection.query(
      "SELECT COUNT(*) AS n FROM invoiceItems WHERE accrualId = ?",
      [accrual.id]
    );
    expect(Number(n)).toBe(1);
  });

  it("an invoiced accrual can no longer be edited or deleted", async () => {
    const accrual = await draftAccrual("300.00");
    await db.createInvoice(
      {
        invoiceNumber: `INV-LOCK-${Date.now()}`,
        issueDate: new Date(),
        period: "2026-09",
        tenantName: "Race Test",
        totalAmount: "0.00",
        status: "issued",
      },
      [
        {
          invoiceId: 0,
          accrualId: accrual.id,
          description: "lock",
          amount: "300.00",
        },
      ]
    );
    await expect(
      db.updateDraftAccrual(accrual.id, { amount: "1.00" })
    ).rejects.toThrow();
    await expect(db.deleteAccrual(accrual.id)).rejects.toThrow();
  });

  it("invoice lines and total always come from the locked accrual amounts", async () => {
    const accrual = await draftAccrual("250.00");
    const invoice = await db.createInvoice(
      {
        invoiceNumber: `INV-AMT-${Date.now()}`,
        issueDate: new Date(),
        period: "2026-09",
        tenantName: "Race Test",
        totalAmount: "1.00",
        status: "issued",
      },
      [
        {
          invoiceId: 0,
          accrualId: accrual.id,
          description: "amt",
          amount: "1.00",
        },
      ]
    );
    expect(invoice.totalAmount).toBe("250.00");
    const [[item]]: any = await connection.query(
      "SELECT amount FROM invoiceItems WHERE invoiceId = ?",
      [invoice.id]
    );
    expect(item.amount).toBe("250.00");
  });

  it("a contract cannot hold two accruals for the same month", async () => {
    const [result]: any = await connection.query(
      "INSERT INTO contracts (tenantName, propertyName, startDate, endDate, tariffType, tariffAmount, status) VALUES ('U', 'Блок 38', '2026-01-01', '2026-12-31', 'monthly', '1.00', 'active')"
    );
    const contractId = result.insertId;
    const row = {
      contractId,
      period: "2026-10",
      serviceFrom: new Date("2026-10-01T00:00:00Z"),
      serviceTo: new Date("2026-10-31T00:00:00Z"),
      quantity: "1.00",
      amount: "1.00",
      status: "draft" as const,
    };
    const attempts = await Promise.allSettled(
      [1, 2, 3].map(() => db.createAccrual(row))
    );
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });

  it("12. the login limiter is shared through the database (multi-instance safe)", async () => {
    const key = rate.rateKey(
      "ip-email",
      "203.0.113.50",
      `db-${Date.now()}@example.com`
    );
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () =>
        rate.consume(rate.RULES.loginPerAccountAndIp, key)
      )
    );
    expect(outcomes.filter(o => o.allowed)).toHaveLength(
      rate.RULES.loginPerAccountAndIp.limit
    );
    const [[row]]: any = await connection.query(
      "SELECT `count` FROM rateLimits WHERE `key` LIKE ?",
      [`%${key}`]
    );
    expect(Number(row.count)).toBe(12);
  });
});
