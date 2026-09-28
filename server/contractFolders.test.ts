import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listContractFolders: vi.fn(async () => [{ id: 1, name: "Блок А1" }]),
  createContractFolder: vi.fn(async (name: string) => ({ id: 2, name })),
  renameContractFolder: vi.fn(async (id: number, name: string) => ({
    id,
    name,
  })),
  deleteContractFolder: vi.fn(async (id: number) => ({ success: true, id })),
  moveContractsToFolder: vi.fn(async (ids: number[], folderName: string) => ({
    moved: ids.length,
    folderName,
  })),
}));

vi.mock("./db", () => ({
  ...mocks,
  createAccrual: vi.fn(),
  createContract: vi.fn(),
  createDocument: vi.fn(),
  createInvoice: vi.fn(),
  deleteAccrual: vi.fn(),
  getContract: vi.fn(),
  getDocument: vi.fn(),
  getInvoice: vi.fn(),
  getInvoiceItems: vi.fn(),
  listAccruals: vi.fn(async () => []),
  listContracts: vi.fn(async () => []),
  listDocuments: vi.fn(async () => []),
  listInvoices: vi.fn(async () => []),
  markAccrualsInvoiced: vi.fn(),
  updateAccrual: vi.fn(),
  updateContract: vi.fn(),
  updateInvoiceEmail: vi.fn(),
}));

import { appRouter } from "./routers";

const ctx = { user: { id: 1, role: "admin" }, req: {}, res: {} } as any;

describe("contract folder management", () => {
  it("lists, creates, renames and removes folders", async () => {
    const caller = appRouter.createCaller(ctx);
    expect(await caller.contractFolders.list()).toEqual([
      { id: 1, name: "Блок А1" },
    ]);
    expect(await caller.contractFolders.create({ name: "Новый блок" })).toEqual(
      { id: 2, name: "Новый блок" }
    );
    expect(
      await caller.contractFolders.rename({
        id: 2,
        oldName: "Новый блок",
        name: "Блок А5",
      })
    ).toEqual({ id: 2, name: "Блок А5" });
    expect(await caller.contractFolders.remove({ id: 2 })).toEqual({
      success: true,
      id: 2,
    });
    expect(mocks.createContractFolder).toHaveBeenCalledWith("Новый блок");
    expect(mocks.renameContractFolder).toHaveBeenCalledWith(
      2,
      "Блок А5",
      "Новый блок"
    );
    expect(mocks.deleteContractFolder).toHaveBeenCalledWith(2);
  });

  it("moves selected contracts to the destination folder", async () => {
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.contracts.moveToFolder({
        ids: [11, 12, 13],
        folderName: "Блок А2",
      })
    ).resolves.toEqual({ moved: 3, folderName: "Блок А2" });
    expect(mocks.moveContractsToFolder).toHaveBeenCalledWith(
      [11, 12, 13],
      "Блок А2"
    );
  });
});
