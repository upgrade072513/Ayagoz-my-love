import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeLLM: vi.fn(async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            tenantName: "ТОО Альфа",
            tenantContact: "+77000000000",
            tenantEmail: "billing@example.com",
            propertyName: "Объект OCR",
            unitName: "101",
            startDate: "2026-07-10",
            endDate: "2026-07-12",
            tariffType: "daily",
            tariffAmount: 5000,
            status: "ended",
            confidence: 0.94,
            warnings: [],
          }),
        },
      },
    ],
  })),
  listLLMModels: vi.fn(async () => ({
    data: [{ id: "gemini-3-flash-preview" }],
  })),
  storagePut: vi.fn(async () => ({
    key: "user/contracts/scans/scan.png",
    url: "/manus-storage/user/contracts/scans/scan.png",
  })),
  createContract: vi.fn(async (input: any) => ({ id: 42, ...input })),
  createDocument: vi.fn(async (input: any) => ({ id: 77, ...input })),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: mocks.invokeLLM,
  listLLMModels: mocks.listLLMModels,
}));
vi.mock("./storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("./db", () => ({
  ...mocks,
  getContract: vi.fn(),
  getInvoiceItems: vi.fn(),
  listAccruals: vi.fn(async () => []),
  listContracts: vi.fn(async () => []),
  listDocuments: vi.fn(async () => []),
  listInvoices: vi.fn(async () => []),
  markAccrualsInvoiced: vi.fn(),
  updateAccrual: vi.fn(),
  updateContract: vi.fn(),
}));

import { appRouter } from "./routers";

const ctx = { user: { id: 1, role: "admin" }, req: {}, res: {} } as any;
const dataUrl = `data:image/png;base64,${"A".repeat(80)}`;

describe("contracts scan OCR", () => {
  beforeEach(() => {
    vi.stubEnv(
      "FILE_ENCRYPTION_KEY",
      "test-contract-file-key-with-at-least-32-bytes"
    );
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://forge.test");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "test-key");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("previews extracted contract fields and preserves only supported tariff values", async () => {
    const caller = appRouter.createCaller(ctx);
    const result = await caller.contracts.previewScan({
      dataUrl,
      mimeType: "image/png",
    });
    expect(result).toMatchObject({
      tenantName: "ТОО Альфа",
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      tariffType: "daily",
      tariffAmount: 5000,
      confidence: 0.94,
    });
    expect(mocks.listLLMModels).toHaveBeenCalled();
    expect(mocks.invokeLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3-flash-preview",
        response_format: expect.objectContaining({ type: "json_schema" }),
      })
    );
  });

  it("falls back to filename identity when OCR capacity returns 412", async () => {
    mocks.listLLMModels.mockRejectedValueOnce(
      new Error("412 Precondition Failed: usage exhaustion")
    );
    const caller = appRouter.createCaller(ctx);
    const result = await caller.contracts.previewScan({
      dataUrl,
      fileName: "№ 0475-2026/08-23 от 01.09.2026.pdf",
      mimeType: "application/pdf",
    });
    expect(result).toMatchObject({
      contractNumber: "0475-2026/08-23",
      contractDate: "2026-09-01",
      confidence: 0,
      tenantName: null,
      tariffAmount: null,
    });
    expect(result.warnings.join(" ")).toMatch(/OCR временно недоступен|лимит/i);
  });

  it("keeps low-confidence OCR results for mandatory manual review", async () => {
    mocks.invokeLLM.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              tenantName: "Неуверенный",
              tenantContact: null,
              tenantEmail: null,
              propertyName: "Объект",
              unitName: null,
              startDate: null,
              endDate: null,
              tariffType: null,
              tariffAmount: null,
              status: null,
              confidence: 0.41,
              warnings: ["Не удалось уверенно прочитать даты и ставку"],
            }),
          },
        },
      ],
    } as any);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.contracts.previewScan({
      dataUrl,
      mimeType: "image/png",
    });
    expect(result.confidence).toBe(0.41);
    expect(result.warnings).toContain(
      "Не удалось уверенно прочитать даты и ставку"
    );
  });

  it("rejects unsupported scan MIME types before calling OCR", async () => {
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.contracts.previewScan({ dataUrl, mimeType: "text/plain" as any })
    ).rejects.toThrow();
  });

  it("saves a confirmed OCR result and attaches the original scan", async () => {
    const caller = appRouter.createCaller(ctx);
    const result = await caller.contracts.createFromScan({
      fileName: "договор 101.png",
      mimeType: "image/png",
      dataUrl,
      fields: {
        tenantName: "ТОО Альфа",
        tenantContact: "+77000000000",
        tenantEmail: "billing@example.com",
        propertyName: "Объект OCR",
        unitName: "101",
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        tariffType: "daily",
        tariffAmount: 5000,
        status: "ended",
        notes: "",
      },
    });
    expect(result).toMatchObject({
      id: 42,
      tariffType: "daily",
      tariffAmount: "5000.00",
    });
    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.stringContaining("contracts/scans/"),
      expect.any(Buffer),
      "application/octet-stream"
    );
    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 42,
        fileName: "договор 101.png",
        mimeType: "image/png",
      })
    );
  });

  it("falls back to manual review when OCR returns malformed JSON", async () => {
    mocks.invokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "not-json" } }],
    } as any);
    mocks.createContract.mockClear();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.contracts.previewScan({
      dataUrl,
      fileName: "Д-999 от 23.09.2026.png",
      mimeType: "image/png",
    });
    expect(result.confidence).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/повреждённый JSON/i);
    expect(result.contractNumber).toBe("Д-999");
    expect(mocks.createContract).not.toHaveBeenCalled();
  });

  it("fills number and date from the file name when no recognition service is connected", async () => {
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "");
    const result = await appRouter
      .createCaller(ctx)
      .contracts.previewScan({
        dataUrl: "data:application/pdf;base64," + "A".repeat(60),
        mimeType: "application/pdf",
        fileName: "12-A от 01.02.2026.pdf",
      });
    expect(result).toMatchObject({
      contractNumber: "12-A",
      contractDate: "2026-02-01",
      confidence: 0,
    });
  });
});
