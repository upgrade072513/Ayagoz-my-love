import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAccruals: vi.fn(async () => [{ id: 10, contractId: 7, status: "draft" }, { id: 11, contractId: null, status: "draft" }]),
  getContract: vi.fn(async (id: number) => id === 7 ? { id: 7, departmentId: 3 } : undefined),
  deleteAccrual: vi.fn(async (id: number) => ({ id, status: "draft" })),
  clearDraftAccruals: vi.fn(async () => ({ deleted: 0, skipped: 0, requested: 0 })),
  permanentlyDeleteContract: vi.fn(async (id: number) => ({ success: true, id, deletedAccruals: 1, deletedDocuments: 1 })),
  permanentlyDeleteContracts: vi.fn(async (ids: number[]) => ({ success: true, ids, deletedContracts: ids.length, deletedAccruals: ids.length, deletedDocuments: ids.length })),
  listPermanentlyDeletableContractIds: vi.fn(async () => [7]),
}));

vi.mock("./db", () => ({
  ...mocks,
  createAccrual: vi.fn(), createContract: vi.fn(), createDocument: vi.fn(), createInvoice: vi.fn(),
  deleteContract: vi.fn(), getInvoice: vi.fn(), getInvoiceItems: vi.fn(), listContracts: vi.fn(async () => []),
  listDocuments: vi.fn(async () => []), listInvoices: vi.fn(async () => []), markAccrualsInvoiced: vi.fn(),
  updateAccrual: vi.fn(), updateContract: vi.fn(), updateInvoiceEmail: vi.fn(), listPayments: vi.fn(async () => []),
  listPaymentAudit: vi.fn(async () => []), recalculateInvoicePaymentStatus: vi.fn(), recordPayment: vi.fn(),
  reversePayment: vi.fn(), updateInvoicePaymentStatus: vi.fn(), listDepartments: vi.fn(async () => []),
  listUsers: vi.fn(async () => []), updateUserAccess: vi.fn(), listDocumentPermissions: vi.fn(async () => []),
  upsertDocumentPermission: vi.fn(), deleteDocumentPermission: vi.fn(), createContractAudit: vi.fn(),
  listContractAudit: vi.fn(), buildExistingUserUpsertPatch: vi.fn(),
}));

import { appRouter } from "./routers";

const caller = (user: any) => appRouter.createCaller({ user, req: {}, res: {} } as any);

const manager = (departmentId: number) => ({ id: 2, role: "manager", departmentId });

describe("protected accrual deletion", () => {
  beforeEach(() => {
    mocks.deleteAccrual.mockClear();
    mocks.clearDraftAccruals.mockClear();
  });
  it("allows a Manager to delete a draft accrual in the same department", async () => {
    await caller(manager(3)).accruals.remove({ id: 10 });
    expect(mocks.deleteAccrual).toHaveBeenCalledWith(10);
  });

  it("rejects a Manager deleting another department's accrual", async () => {
    await expect(caller(manager(9)).accruals.remove({ id: 10 })).rejects.toThrow("Нет доступа к начислению другого подразделения");
    expect(mocks.deleteAccrual).not.toHaveBeenCalledWith(10);
  });

  it("allows only an Administrator to permanently delete a contract", async () => {
    await expect(caller(manager(3)).contracts.permanentlyDelete({ id: 7, confirmation: "УДАЛИТЬ" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller({ id: 1, role: "admin", departmentId: null }).contracts.permanentlyDelete({ id: 7, confirmation: "УДАЛИТЬ" });
    expect(mocks.permanentlyDeleteContract).toHaveBeenCalledWith(7);
  });

  it("allows an Administrator to permanently delete several contracts", async () => {
    await caller({ id: 1, role: "admin", departmentId: null }).contracts.permanentlyDeleteMany({ ids: [7, 8], confirmation: "УДАЛИТЬ" });
    expect(mocks.permanentlyDeleteContracts).toHaveBeenCalledWith([7, 8]);
  });

  it("lists permanently deletable contracts for an Administrator", async () => {
    await expect(caller(manager(3)).contracts.permanentDeleteEligible()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller({ id: 1, role: "admin", departmentId: null }).contracts.permanentDeleteEligible()).resolves.toEqual([7]);
  });

  it("keeps standalone accrual deletion Administrator-only", async () => {
    await expect(caller(manager(3)).accruals.remove({ id: 11 })).rejects.toThrow("только Administrator");
    await caller({ id: 1, role: "admin", departmentId: null }).accruals.remove({ id: 11 });
    expect(mocks.deleteAccrual).toHaveBeenCalledWith(11);
  });

  it("keeps bulk history clearing Administrator-only", async () => {
    await expect(caller(manager(3)).accruals.clearHistory({ period: "2026-08" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller({ id: 1, role: "admin", departmentId: null }).accruals.clearHistory({ period: "2026-08" });
    expect(mocks.clearDraftAccruals).toHaveBeenCalledWith("2026-08");
  });
});
