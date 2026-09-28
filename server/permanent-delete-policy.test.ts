import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("permanent contract deletion policy", () => {
  it("allows deleting a contract with billed accruals while preserving invoice history", () => {
    const source = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
    const start = source.indexOf("export async function permanentlyDeleteContract");
    const end = source.indexOf("export async function permanentlyDeleteContracts", start);
    const body = source.slice(start, end);

    expect(body).toContain(".set({ contractId: null })");
    expect(body).toContain("instead of deleting invoiceItems/accruals");
    expect(body).not.toContain(".delete(invoiceItems)");
    expect(body).not.toContain("tx.delete(accruals)");
    expect(body).not.toContain("по нему выставлены счета");
  });

  it("does not filter permanent-delete eligibility by invoice history", () => {
    const source = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
    const start = source.indexOf("export async function listPermanentlyDeletableContractIds");
    const end = source.indexOf("export async function getUserByEmailNormalized", start);
    const body = source.slice(start, end);

    expect(body).toContain(".from(contracts)");
    expect(body).not.toContain("having(sql`COUNT(");
    expect(body).not.toContain("invoiceItems.accrualId");
  });
});
