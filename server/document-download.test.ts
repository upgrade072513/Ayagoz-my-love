import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptContractFile } from "./fileCrypto";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getContract: vi.fn(),
  listDocumentPermissions: vi.fn(async () => []),
  storageRead: vi.fn(),
}));

vi.mock("./db", () => ({
  ...mocks,
  createAccrual: vi.fn(), createContract: vi.fn(), createDocument: vi.fn(), createInvoice: vi.fn(), deleteAccrual: vi.fn(),
  getInvoice: vi.fn(), getInvoiceItems: vi.fn(), listAccruals: vi.fn(async () => []), listContracts: vi.fn(async () => []),
  listDocuments: vi.fn(async () => []), listInvoices: vi.fn(async () => []), markAccrualsInvoiced: vi.fn(), updateAccrual: vi.fn(),
  updateContract: vi.fn(), updateInvoiceEmail: vi.fn(), listPayments: vi.fn(async () => []), listPaymentAudit: vi.fn(async () => []),
  recalculateInvoicePaymentStatus: vi.fn(), recordPayment: vi.fn(), reversePayment: vi.fn(), updateInvoicePaymentStatus: vi.fn(),
  listDepartments: vi.fn(async () => []), listUsers: vi.fn(async () => []), updateUserAccess: vi.fn(),
  upsertDocumentPermission: vi.fn(), deleteDocumentPermission: vi.fn(), createContractAudit: vi.fn(), listContractAudit: vi.fn(),
  clearDraftAccruals: vi.fn(), deleteContract: vi.fn(),
}));

vi.mock("./storage", () => ({ storagePut: vi.fn(), storageRead: mocks.storageRead }));

import { appRouter } from "./routers";

const caller = (user: any) => appRouter.createCaller({ user, req: {}, res: {} } as any);

 describe("protected document download", () => {
  beforeEach(() => {
    vi.stubEnv("FILE_ENCRYPTION_KEY", "test-contract-file-key-with-at-least-32-bytes");
    const encrypted = encryptContractFile(Buffer.from("confidential contract", "utf8"));
    mocks.getDocument.mockResolvedValue({ id: 5, contractId: 7, fileName: "contract.pdf", mimeType: "application/pdf", fileKey: "7/contracts/contract.enc", encryptionVersion: encrypted.version, encryptionIv: encrypted.iv, encryptionAuthTag: encrypted.authTag });
    mocks.getContract.mockResolvedValue({ id: 7, departmentId: 3, blockFolder: "Блок А1" });
    mocks.storageRead.mockReset();
    mocks.storageRead.mockResolvedValue(encrypted.data);
  });

  it("decrypts a document for an authorized department user", async () => {
    const result = await caller({ id: 2, role: "manager", managedBlocks: JSON.stringify(["Блок А1"]), departmentId: 3 }).documents.download({ documentId: 5 });
    expect(Buffer.from(result.dataBase64, "base64").toString("utf8")).toBe("confidential contract");
    expect(result).toMatchObject({ fileName: "contract.pdf", mimeType: "application/pdf" });
  });

  it("rejects a user from another department before storage fetch", async () => {
    await expect(caller({ id: 9, role: "manager", managedBlocks: JSON.stringify(["Блок А2"]), departmentId: 9 }).documents.download({ documentId: 5 })).rejects.toThrow("Нет доступа к документу");
    expect(mocks.storageRead).not.toHaveBeenCalled();
  });
});
