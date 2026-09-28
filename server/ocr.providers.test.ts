import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  listContracts: vi.fn(async () => []),
  listAccruals: vi.fn(async () => []),
}));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageRead: vi.fn() }));

import { appRouter } from "./routers";

const caller = () =>
  appRouter.createCaller({
    user: { id: 1, role: "admin" },
    req: {},
    res: {},
  } as any);
const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n" + "x".repeat(60)).toString("base64")}`;
const reply = {
  contractNumber: "0294-2026/08-23",
  contractDate: "2026-07-07",
  tenantName: "Асылбек Нұрқали",
  tenantContact: "+77472415362",
  tenantEmail: "nurkali@nu.edu.kz",
  propertyName: "Блок 38",
  unitName: "510",
  startDate: "2026-09-01",
  endDate: "2027-06-30",
  tariffType: "monthly",
  tariffAmount: "162 400",
  confidence: 0.9,
  fieldConfidence: { tenantName: 0.95 },
  warnings: [],
};

describe("automatic scan recognition", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fills contract fields from Gemini and sends the PDF inline", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify(reply) }] } },
            ],
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await caller().contracts.previewScan({
      dataUrl: pdf,
      mimeType: "application/pdf",
      fileName: "scan.pdf",
    });
    expect(result).toMatchObject({
      tenantName: "Асылбек Нұрқали",
      tariffAmount: 162400,
      tariffType: "monthly",
      status: null,
      contractNumber: "0294-2026/08-23",
    });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(
      JSON.parse(init.body).contents[0].parts[0].inline_data.mime_type
    ).toBe("application/pdf");
  });

  it("prefers Claude when its key is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-key");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: "```json\n" + JSON.stringify(reply) + "\n```",
              },
            ],
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await caller().contracts.previewScan({
      dataUrl: pdf,
      mimeType: "application/pdf",
      fileName: "scan.pdf",
    });
    expect(result.tenantEmail).toBe("nurkali@nu.edu.kz");
    expect((fetchMock.mock.calls[0] as any)[0]).toBe(
      "https://api.anthropic.com/v1/messages"
    );
  });

  it("AI fields are combined with the contract number from the scan's file name", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ...reply,
                    contractNumber: null,
                    tenantName: "Nancy Lee Stitt",
                  }),
                },
              ],
            })
          )
      )
    );
    const result = await caller().contracts.previewScan({
      dataUrl: pdf,
      mimeType: "application/pdf",
      fileName: "0531-2026-08-23 от 31.08.2026г. Nancy Lee Stitt аренда 44 блок.PDF",
    });
    expect(result).toMatchObject({
      contractNumber: "0531-2026/08-23",
      tenantName: "Nancy Lee Stitt",
      tariffAmount: 162400,
    });
    expect(result.warnings.join(" ")).toMatch(/Распознано ИИ/);
  });

  it("falls back to the file name with a clear warning when the service rejects the key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "bad");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { message: "API key not valid" } }),
            { status: 400 }
          )
      )
    );
    const result = await caller().contracts.previewScan({
      dataUrl: pdf,
      mimeType: "application/pdf",
      fileName: "12-A от 01.02.2026.pdf",
    });
    expect(result).toMatchObject({
      contractNumber: "12-A",
      contractDate: "2026-02-01",
      confidence: 0,
    });
    // The provider's own error text (may contain keys/URLs) is logged, not shown to the user.
    expect(result.warnings.join(" ")).toMatch(/ИИ-распознавание/);
    expect(result.warnings.join(" ")).not.toContain("API key");
  });
});
