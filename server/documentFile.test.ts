import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";

const doc = { id: 5, contractId: 1, fileName: "0515 скан.pdf", mimeType: "application/pdf", fileKey: "k", encryptionVersion: 0, encryptionIv: null, encryptionAuthTag: null };
vi.mock("./localAuth", () => ({
  authenticateLocalRequest: vi.fn(async (req: any) =>
    req.headers.cookie ? { id: 1, role: "admin", mustChangePassword: false } : null
  ),
}));
vi.mock("./authz", () => ({
  requireDocumentAccess: vi.fn(async (_user: any, id: number) => {
    if (id !== 5) throw Object.assign(new Error("nf"), { code: "NOT_FOUND" });
    return { document: doc, contract: {} };
  }),
}));
vi.mock("./storage", () => ({ storageRead: vi.fn(async () => Buffer.from("%PDF-1.4 test")) }));
vi.mock("./security/rateLimit", () => ({
  consume: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
  rateKey: (...parts: unknown[]) => parts.join(":"),
  RULES: { pdfRender: {} },
}));

import { registerDocumentFileRoute } from "./documentFile";
import { storageRead } from "./storage";

let base = "";
let server: any;
beforeAll(async () => {
  const app = express();
  registerDocumentFileRoute(app);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

describe("GET /api/documents/:id/file", () => {
  it("streams the scan as binary for the viewer", async () => {
    const response = await fetch(`${base}/api/documents/5/file`, { headers: { cookie: "s=1" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^inline/);
    expect(await response.text()).toBe("%PDF-1.4 test");
  });
  it("download=1 → attachment with the original name", async () => {
    const response = await fetch(`${base}/api/documents/5/file?download=1`, { headers: { cookie: "s=1" } });
    expect(response.headers.get("content-disposition")).toMatch(/^attachment.*filename\*=UTF-8''0515/);
  });
  it("requires a session and access", async () => {
    expect((await fetch(`${base}/api/documents/5/file`)).status).toBe(401);
    expect((await fetch(`${base}/api/documents/6/file`, { headers: { cookie: "s=1" } })).status).toBe(404);
    expect((await fetch(`${base}/api/documents/abc/file`, { headers: { cookie: "s=1" } })).status).toBe(400);
  });
  it("a missing stored file gives a readable message, not an endless spinner", async () => {
    vi.mocked(storageRead).mockRejectedValueOnce(new Error("ENOENT"));
    const response = await fetch(`${base}/api/documents/5/file`, { headers: { cookie: "s=1" } });
    expect(response.status).toBe(404);
    expect(await response.text()).toMatch(/не найден в хранилище/);
  });
});
