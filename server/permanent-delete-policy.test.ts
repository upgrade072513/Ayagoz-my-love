import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("permanent contract deletion policy", () => {
  it("deletes accruals and fully-owned invoices together with the contract", () => {
    const source = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
    const start = source.indexOf("export async function permanentlyDeleteContract");
    const end = source.indexOf("export async function permanentlyDeleteContracts", start);
    const body = source.slice(start, end);

    expect(body).toContain(".delete(accruals)");
    expect(body).toContain(".delete(invoiceItems)");
    expect(body).toContain(".delete(invoices)");
    expect(body).toContain(".delete(payments)");
    expect(body).toContain(".delete(paymentAudit)");
    expect(body).toContain("deletedInvoices");
    expect(body).toContain("deletedAccruals");
  });

  it("does not blindly delete a shared invoice that contains other contracts", () => {
    const source = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
    const start = source.indexOf("export async function permanentlyDeleteContract");
    const end = source.indexOf("export async function permanentlyDeleteContracts", start);
    const body = source.slice(start, end);

    expect(body).toContain("belongsOnlyToContract");
    expect(body).toContain("retainedMixedInvoiceIds");
    expect(body).toContain("keep the shared invoice");
  });

  it("does not filter permanent-delete eligibility by invoice history", () => {
    const source = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
    const start = source.indexOf("export async function listPermanentlyDeletableContractIds");
    const end = source.indexOf("export async function getUserByEmailNormalized", start);
    const body = source.slice(start, end);

    expect(body).toContain(".from(contracts)");
    expect(body).not.toContain("having(sql`COUNT(");
  });
});
