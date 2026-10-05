import { describe, expect, it, vi } from "vitest";

const contracts = [
  { id: 1, contractNumber: "374-2026", tenantName: "A", propertyName: "Блок 39", blockFolder: "Блок А3" },
  { id: 2, contractNumber: "0525-2026/08-23", tenantName: "B", propertyName: "Блок 39", blockFolder: "Блок А3" },
  { id: 3, contractNumber: "502-2026", tenantName: "C", propertyName: "Блок 38", blockFolder: "PHD Student" },
  { id: 4, contractNumber: "0502-2026/08-23", tenantName: "C2", propertyName: "Блок 38", blockFolder: "PHD Student" },
  { id: 5, contractNumber: "Д-2026-001", tenantName: "D", propertyName: "Блок 38", blockFolder: "Блок А1" },
];
const updateContract = vi.fn(async (id: number, data: any) => ({ ...contracts.find(c => c.id === id), ...data }));
vi.mock("./db", async importOriginal => ({
  ...(await importOriginal<any>()),
  listContracts: vi.fn(async () => contracts),
  getContract: vi.fn(async (id: number) => contracts.find(c => c.id === id)),
  updateContract: (...args: any[]) => updateContract(...(args as [number, any])),
  createContractAudit: vi.fn(async () => ({})),
}));

import { appRouter } from "./routers";
const caller = appRouter.createCaller({ user: { id: 1, role: "admin" }, req: {}, res: {} } as any);

describe("append a suffix to contract numbers", () => {
  it("changes only «номер-год» numbers and skips ones that would duplicate", async () => {
    const dry = await caller.contracts.appendNumberSuffix({ suffix: "/08-23", dryRun: true });
    expect(dry.plan.map(p => [p.oldNumber, p.newNumber, Boolean(p.conflict)])).toEqual([
      ["374-2026", "374-2026/08-23", false],
      ["502-2026", "502-2026/08-23", true], // 0502-2026/08-23 already exists
    ]);
    expect(updateContract).not.toHaveBeenCalled();
    const done = await caller.contracts.appendNumberSuffix({ suffix: "/08-23", dryRun: false });
    expect(done.updated).toBe(1);
    expect(updateContract).toHaveBeenCalledWith(1, { contractNumber: "374-2026/08-23" });
  });
});
