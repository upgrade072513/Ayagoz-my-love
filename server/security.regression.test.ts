// Security regression tests: attacks are sent straight to the tRPC procedures and to the HTTP server
// (not through the UI). Data model: manager Alice owns "Блок А1" objects (contract 1, accruals 11/12,
// invoice 101, payment 1001, document 501); manager Bob owns the "Блок А2" twins (2, 21/22, 201, 2001, 502).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import XLSX from "xlsx-js-style"; // test fixtures only

const mem = vi.hoisted(() => {
  // Production error handling / headers are what is under test.
  process.env.NODE_ENV = "production";
  return { db: null as any, stored: [] as string[] };
});
vi.mock("./db", async () => {
  const { createMemoryDb } = await import("./testing/memoryDb");
  mem.db = createMemoryDb();
  return mem.db;
});
vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => {
    mem.stored.push(key);
    return { key, url: `/files/${key}` };
  }),
  storageRead: vi.fn(async () => Buffer.from("%PDF-1.4\nconfidential\n")),
}));

import { appRouter } from "./routers";
import { createApiApp } from "./_core/app";
import { tokenHash } from "./testing/memoryDb";
import { decodeUpload, storageSafeName } from "./security/upload";
import {
  inspectZip,
  matrixToObjects,
  readFirstSheetMatrix,
} from "./security/spreadsheet";
import {
  assertSafeUrlShape,
  guardedLookup,
  isPrivateAddress,
  safeRequest,
} from "./security/ssrf";
import { _memoryForTests } from "./security/rateLimit";
const { diskPath } =
  await vi.importActual<typeof import("./storage")>("./storage");
import { hashPassword } from "./localAuth";

const ADMIN = { id: 1, role: "admin", managedBlocks: null, departmentId: null };
const ALICE = {
  id: 2,
  role: "manager",
  managedBlocks: JSON.stringify(["Блок А1"]),
  departmentId: 1,
};
const call = (user: any) =>
  appRouter.createCaller({
    user,
    req: { ip: "198.51.100.7", headers: {}, get: () => "" },
    res: { cookie: vi.fn(), clearCookie: vi.fn() },
  } as any);
const forbidden = { code: "FORBIDDEN" };

beforeEach(() => {
  vi.stubEnv(
    "FILE_ENCRYPTION_KEY",
    "test-contract-file-key-with-at-least-32-bytes"
  );
  mem.db.seed();
  mem.stored.length = 0;
  _memoryForTests.clear();
});

describe("1. invoices of another block are unreachable (IDOR/BOLA)", () => {
  it("lists only own invoices", async () => {
    const rows = await call(ALICE).invoices.list();
    expect(rows.map(r => r.id)).toEqual([101]);
  });
  it.each([
    ["items", (c: any) => c.invoices.items({ invoiceId: 201 })],
    ["previewEmail", (c: any) => c.invoices.previewEmail({ invoiceId: 201 })],
    ["markEmailSent", (c: any) => c.invoices.markEmailSent({ invoiceId: 201 })],
    ["paymentAudit", (c: any) => c.invoices.paymentAudit({ invoiceId: 201 })],
    [
      "payments(invoiceId)",
      (c: any) => c.invoices.payments({ invoiceId: 201 }),
    ],
    [
      "refreshPaymentStatus",
      (c: any) => c.invoices.refreshPaymentStatus({ invoiceId: 201 }),
    ],
    [
      "updatePaymentStatus",
      (c: any) =>
        c.invoices.updatePaymentStatus({
          invoiceId: 201,
          paymentStatus: "paid",
        }),
    ],
  ])("rejects %s on a foreign invoice", async (_name, attack) => {
    await expect(attack(call(ALICE))).rejects.toMatchObject(forbidden);
  });
  it("still allows the same operations on an own invoice", async () => {
    await expect(
      call(ALICE).invoices.items({ invoiceId: 101 })
    ).resolves.toHaveLength(1);
    await expect(
      call(ALICE).invoices.previewEmail({ invoiceId: 101 })
    ).resolves.toMatchObject({ recipient: "ivan@example.com" });
  });
  it("returns NOT_FOUND for invoices that do not exist", async () => {
    await expect(
      call(ALICE).invoices.items({ invoiceId: 999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("2. payments of another block are unreachable", () => {
  it("cannot record a payment on a foreign invoice", async () => {
    await expect(
      call(ALICE).invoices.recordPayment({
        invoiceId: 201,
        amount: 1,
        paidAt: "2026-08-10",
        method: "bank",
      })
    ).rejects.toMatchObject(forbidden);
    expect(mem.db.state.payments).toHaveLength(2);
  });
  it("cannot reverse a foreign payment", async () => {
    await expect(
      call(ALICE).invoices.reversePayment({ paymentId: 2001 })
    ).rejects.toMatchObject(forbidden);
    expect(mem.db.state.payments.find((p: any) => p.id === 2001).status).toBe(
      "posted"
    );
  });
  it("does not see foreign payments in the global list", async () => {
    const rows = await call(ALICE).invoices.payments();
    expect(rows.map((p: any) => p.id)).toEqual([1001]);
  });
  it("cannot import a payment into a foreign invoice by its number", async () => {
    const result = await call(ALICE).invoices.importPayments({
      rows: [
        {
          invoiceNumber: "INV-2026-201",
          amount: 5,
          paidAt: "2026-08-10",
          method: "bank",
        },
      ],
    });
    expect(result.imported).toHaveLength(0);
    expect(result.errors[0].message).toBe("Счёт не найден");
  });
  it("rejects NaN / Infinity / negative / huge amounts", async () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1e15])
      await expect(
        call(ALICE).invoices.recordPayment({
          invoiceId: 101,
          amount,
          paidAt: "2026-08-10",
          method: "bank",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("3. foreign accruals cannot be billed or edited", () => {
  it("cannot put a foreign accrual into an invoice", async () => {
    await expect(
      call(ALICE).invoices.create({
        period: "2026-08",
        tenantName: "Пётр Петров",
        accrualIds: [21],
      })
    ).rejects.toMatchObject(forbidden);
    await expect(
      call(ALICE).invoices.create({
        period: "2026-08",
        tenantName: "Иван Иванов",
        accrualIds: [11, 21],
      })
    ).rejects.toMatchObject(forbidden);
    expect(mem.db.state.accruals.find((a: any) => a.id === 21).status).toBe(
      "draft"
    );
  });
  it("cannot bill an already invoiced accrual twice", async () => {
    await expect(
      call(ALICE).invoices.create({
        period: "2026-08",
        tenantName: "Иван Иванов",
        accrualIds: [12],
      })
    ).rejects.toThrow(/уже включена/);
  });
  it("bills own draft accruals exactly once", async () => {
    const invoice = await call(ALICE).invoices.create({
      period: "2026-08",
      tenantName: "Иван Иванов",
      accrualIds: [11],
    });
    expect(invoice.tenantName).toBe("Иван Иванов");
    await expect(
      call(ALICE).invoices.create({
        period: "2026-08",
        tenantName: "Иван Иванов",
        accrualIds: [11],
      })
    ).rejects.toThrow();
  });
  it("bulk invoicing never touches foreign accruals", async () => {
    await call(ALICE).invoices.bulkCreate({ period: "2026-08" });
    expect(mem.db.state.accruals.find((a: any) => a.id === 21).status).toBe(
      "draft"
    );
  });
  it.each([
    [
      "updateAmount",
      (c: any) => c.accruals.updateAmount({ id: 21, amount: 1 }),
    ],
    [
      "updateEmail",
      (c: any) =>
        c.accruals.updateEmail({ id: 21, tenantEmail: "x@example.com" }),
    ],
    [
      "updateFromPreview",
      (c: any) => c.accruals.updateFromPreview({ id: 21, amount: 1 }),
    ],
    ["remove", (c: any) => c.accruals.remove({ id: 21 })],
    ["removeMany", (c: any) => c.accruals.removeMany({ ids: [11, 21] })],
  ])("rejects %s on a foreign accrual", async (_name, attack) => {
    await expect(attack(call(ALICE))).rejects.toMatchObject(forbidden);
    expect(mem.db.state.accruals.find((a: any) => a.id === 21)).toMatchObject({
      amount: "120000.00",
    });
    expect(mem.db.state.accruals.find((a: any) => a.id === 11)).toBeTruthy();
  });
  it("cannot re-link an own accrual to a foreign contract", async () => {
    await expect(
      call(ALICE).accruals.updateFromPreview({ id: 11, contractId: 2 })
    ).rejects.toMatchObject(forbidden);
    expect(mem.db.state.accruals.find((a: any) => a.id === 11).contractId).toBe(
      1
    );
  });
  it("cannot re-link an accrual to a contract that is already billed for that month", async () => {
    mem.db.state.accruals.push({
      ...mem.db.state.accruals[0],
      id: 13,
      contractId: null,
      status: "draft",
    });
    await expect(
      call(ALICE).accruals.updateFromPreview({ id: 13, contractId: 1 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("cannot create accruals for another block", async () => {
    await expect(
      call(ALICE).accruals.createStandalone({
        period: "2026-08",
        serviceFrom: "2026-08-01",
        serviceTo: "2026-08-31",
        tenantName: "X",
        propertyName: "Блок 44",
        tariffType: "monthly",
        tariffAmount: 1,
        quantity: 1,
        amount: 1,
      })
    ).rejects.toMatchObject(forbidden);
  });
  it("does not list foreign accruals", async () => {
    const rows = await call(ALICE).accruals.list({ period: "2026-08" });
    expect(rows.map((r: any) => r.id).sort()).toEqual([11, 12]);
  });
});

describe("5. documents of another block are unreachable", () => {
  it("cannot download, delete or list a foreign document", async () => {
    await expect(
      call(ALICE).documents.download({ documentId: 502 })
    ).rejects.toMatchObject(forbidden);
    await expect(
      call(ALICE).documents.delete({ documentId: 502 })
    ).rejects.toMatchObject(forbidden);
    const listed = await call(ALICE).documents.list();
    expect(listed.map((doc: any) => doc.id)).toEqual([501]);
    expect(listed[0]).not.toHaveProperty("fileKey");
  });
  it("cannot attach files to a foreign contract", async () => {
    await expect(
      call(ALICE).documents.upload({
        contractId: 2,
        fileName: "x.pdf",
        mimeType: "application/pdf",
        dataUrl:
          "data:application/pdf;base64," +
          Buffer.from("%PDF-1.4\n").toString("base64"),
      })
    ).rejects.toMatchObject(forbidden);
    expect(mem.stored).toHaveLength(0);
  });
});

describe("6. path traversal", () => {
  it("storage keys never contain path components from the file name", async () => {
    expect(storageSafeName("../../etc/passwd")).not.toMatch(/\/|\.\./);
    expect(storageSafeName("..\\..\\boot.ini")).not.toMatch(/[\\/]|^\./);
    await call(ALICE).documents.upload({
      contractId: 1,
      fileName: "../../../../app/server.js",
      mimeType: "application/pdf",
      dataUrl:
        "data:application/pdf;base64," +
        Buffer.from("%PDF-1.4\n").toString("base64"),
    });
    expect(mem.stored[0]).toMatch(/^2\/contracts\/1\/\d+-server\.js\.enc$/);
  });
  it("disk storage refuses keys that escape the storage directory", () => {
    vi.stubEnv("STORAGE_DIR", "/tmp/storage-root");
    expect(() => diskPath("../../etc/passwd")).toThrow();
    expect(() => diskPath("a/../../etc/passwd")).toThrow();
    expect(diskPath("a/b.enc")).toBe("/tmp/storage-root/a/b.enc");
  });
});

describe("7. SSRF", () => {
  it.each([
    "http://example.com/x",
    "https://127.0.0.1/",
    "https://localhost/",
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.5/",
    "https://172.16.3.4/",
    "https://192.168.1.1/",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
    "https://[64:ff9b::7f00:1]/",
    "https://[2002:7f00:1::]/",
    "https://[fec0::1]/",
  ])("rejects %s", url => {
    expect(() => assertSafeUrlShape(url)).toThrow();
  });
  it("classifies private addresses (incl. IPv4-mapped IPv6)", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.31.0.1",
      "192.168.0.1",
      "169.254.169.254",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "0.0.0.0",
    ])
      expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2a00:1450:4001:80b::200e"])
      expect(isPrivateAddress(ip)).toBe(false);
  });
  it("refuses a hostname that resolves to a private address (DNS check at connect time)", async () => {
    // "localhost" resolves through the real resolver (/etc/hosts) to 127.0.0.1 / ::1.
    const error = await new Promise<Error | null>(resolve =>
      guardedLookup("localhost", {}, err => resolve(err))
    );
    expect(error?.message).toMatch(/Внутренние адреса/);
    await expect(safeRequest("https://localhost/")).rejects.toThrow();
  });
});

describe("8. oversized uploads", () => {
  it("rejects a file above the limit before decoding", () => {
    const big = "data:application/pdf;base64," + "A".repeat(4 * 1024 * 1024);
    expect(() =>
      decodeUpload(big, { kinds: ["pdf"], maxBytes: 1024 * 1024 })
    ).toThrow(/слишком большой/);
  });
  it("rejects an oversized scan at the API boundary", async () => {
    const big = "data:application/pdf;base64," + "A".repeat(21 * 1024 * 1024);
    await expect(
      call(ALICE).contracts.previewScan({
        dataUrl: big,
        mimeType: "application/pdf",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("rejects spoofed types (HTML declared as PDF)", () => {
    const html =
      "data:application/pdf;base64," +
      Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    expect(() =>
      decodeUpload(html, { kinds: ["pdf", "png", "jpeg"], maxBytes: 1e6 })
    ).toThrow();
  });
});

describe("10. malicious Excel files are rejected safely", () => {
  const xlsx = (rows: unknown[][]) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "S");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  };
  it("detects a decompression bomb from the zip directory without inflating it", () => {
    const zip = xlsx([["a"], ["b"]]);
    // Patch the first central-directory entry to claim a 3 GB uncompressed size.
    const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(3_000_000_000, cd + 24);
    expect(() => inspectZip(zip)).toThrow();
  });
  it("does not let a __proto__ header pollute Object.prototype", async () => {
    const rows = matrixToObjects(
      await readFirstSheetMatrix(
        xlsx([
          ["__proto__", "constructor"],
          ['{"polluted":1}', "x"],
        ])
      )
    );
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(rows[0])).toBeNull();
  });
  it("rejects legacy .xls, random bytes and oversized sheets", async () => {
    const ole = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0,
    ]);
    expect(() =>
      decodeUpload(
        "data:application/vnd.ms-excel;base64," + ole.toString("base64"),
        { kinds: ["xlsx"], maxBytes: 1e6 }
      )
    ).toThrow(/xls/);
    await expect(
      readFirstSheetMatrix(Buffer.from("PK\u0003\u0004garbage"))
    ).rejects.toThrow();
    const many = Array.from({ length: 5_100 }, (_, i) => [i]);
    await expect(readFirstSheetMatrix(xlsx(many))).rejects.toThrow(
      /слишком много строк/
    );
  });
  it("import preview requires a permitted role", async () => {
    await expect(
      call({ id: 9, role: "legacy" }).contracts.previewImport({
        dataUrl: "data:x;base64," + "A".repeat(100),
      })
    ).rejects.toMatchObject(forbidden);
  });
});

describe("12. brute-force protection", () => {
  it("locks an account+IP after repeated failures, even for the right password", async () => {
    mem.db.state.users[1].passwordHash = await hashPassword(
      "correct horse battery"
    );
    const login = (password: string) =>
      call(null).auth.login({ email: "alice@nu.edu.kz", password });
    for (let i = 0; i < 8; i++)
      await expect(login("wrong password!")).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    await expect(login("correct horse battery")).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
  it("successful sign-ins do not consume the per-account budget", async () => {
    mem.db.state.users[1].passwordHash = await hashPassword(
      "correct horse battery"
    );
    for (let i = 0; i < 12; i++)
      await expect(
        call(null).auth.login({
          email: "alice@nu.edu.kz",
          password: "correct horse battery",
        })
      ).resolves.toMatchObject({ id: 2 });
  });
  it("does not reveal whether an account exists", async () => {
    await expect(
      call(null).auth.login({
        email: "nobody@nu.edu.kz",
        password: "whatever-123",
      })
    ).rejects.toThrow("Неверный Email или пароль");
    await expect(
      call(null).auth.login({
        email: "alice@nu.edu.kz",
        password: "whatever-123",
      })
    ).rejects.toThrow("Неверный Email или пароль");
  });
});

describe("14/15. exports and previews are scoped", () => {
  it("cannot export another block", async () => {
    await expect(
      call(ALICE).invoices.exportExcel({
        period: "2026-08",
        blockFolder: "Блок А2",
      })
    ).rejects.toMatchObject(forbidden);
  });
  it("an unfiltered export contains only own rows", async () => {
    const result = await call(ALICE).invoices.exportExcel({
      period: "2026-08",
    });
    expect(result.count).toBe(2);
    const preview = await call(ALICE).invoices.previewExcel({
      period: "2026-08",
    });
    expect(preview.totalRows).toBe(2);
  });
  it("preview endpoints require authentication and a permitted role", async () => {
    await expect(
      call(null).invoices.previewEmail({ invoiceId: 101 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      call({ id: 9, role: "legacy" }).invoices.previewExcel({
        period: "2026-08",
      })
    ).rejects.toMatchObject(forbidden);
    await expect(
      call({ id: 9, role: "legacy" }).contracts.previewScan({
        dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
        mimeType: "application/pdf",
      })
    ).rejects.toMatchObject(forbidden);
  });
  it("admin still sees everything", async () => {
    expect((await call(ADMIN).invoices.list()).map(r => r.id).sort()).toEqual([
      101, 201,
    ]);
  });
});

// ------------------------------------------------------------------ HTTP level
describe("HTTP: PDF download, sessions, body limits, CSRF, headers", () => {
  let server: Server;
  let base = "";
  const aliceToken = "alice-session-token";
  const cookie = (token: string) => ({ cookie: `app_session_id=${token}` });

  beforeAll(async () => {
    server = createApiApp().listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise(resolve => server.close(resolve)));
  beforeEach(() => {
    mem.db.state.sessions.push({
      id: 1,
      userId: 2,
      tokenHash: tokenHash(aliceToken),
      expiresAt: new Date(Date.now() + 3600_000),
      revokedAt: null,
      lastSeenAt: new Date(),
    });
  });

  it("4. user cannot download another block's invoice PDF", async () => {
    const own = await fetch(`${base}/api/invoices/101/pdf`, {
      headers: cookie(aliceToken),
    });
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("application/pdf");
    const foreign = await fetch(`${base}/api/invoices/201/pdf`, {
      headers: cookie(aliceToken),
    });
    expect(foreign.status).toBe(403);
    const anonymous = await fetch(`${base}/api/invoices/101/pdf`);
    expect(anonymous.status).toBe(401);
    const weird = await fetch(`${base}/api/invoices/1e3/pdf`, {
      headers: cookie(aliceToken),
    });
    expect(weird.status).toBe(400);
  });

  it("13. a revoked session cannot authenticate", async () => {
    const ok = await fetch(`${base}/api/trpc/invoices.list`, {
      headers: cookie(aliceToken),
    });
    expect(ok.status).toBe(200);
    mem.db.state.sessions[0].revokedAt = new Date();
    const revoked = await fetch(`${base}/api/trpc/invoices.list`, {
      headers: cookie(aliceToken),
    });
    expect(revoked.status).toBe(401);
    const pdf = await fetch(`${base}/api/invoices/101/pdf`, {
      headers: cookie(aliceToken),
    });
    expect(pdf.status).toBe(401);
  });

  it("a session opened with a one-time password dies when that password expires", async () => {
    Object.assign(mem.db.state.users[1], {
      mustChangePassword: true,
      temporaryPasswordExpiresAt: new Date(Date.now() - 1000),
    });
    const response = await fetch(`${base}/api/trpc/auth.me`, {
      headers: cookie(aliceToken),
    });
    expect(JSON.stringify(await response.json())).toContain('"json":null');
  });

  it("9. oversized JSON is rejected with 413 and a generic message", async () => {
    const big = JSON.stringify({ blob: "x".repeat(23 * 1024 * 1024) });
    const response = await fetch(`${base}/api/trpc/contracts.previewScan`, {
      method: "POST",
      headers: { "content-type": "application/json", ...cookie(aliceToken) },
      body: big,
    });
    expect(response.status).toBe(413);
    const small = await fetch(
      `${base}/api/scheduled/archive-expired-contracts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ x: "y".repeat(200 * 1024) }),
      }
    );
    expect(small.status).toBe(413);
    expect(await small.text()).not.toMatch(/node_modules|at \w+ \(/);
  });

  it("blocks cross-site state-changing requests (CSRF)", async () => {
    const attack = await fetch(`${base}/api/trpc/invoices.markEmailSent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        ...cookie(aliceToken),
      },
      body: JSON.stringify({ json: { invoiceId: 101 } }),
    });
    expect(attack.status).toBe(403);
    const form = await fetch(`${base}/api/trpc/invoices.markEmailSent`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...cookie(aliceToken),
      },
      body: "json=1",
    });
    expect(form.status).toBe(415);
  });

  it("sends security headers and no stack traces", async () => {
    const response = await fetch(
      `${base}/api/trpc/invoices.items?input=${encodeURIComponent(JSON.stringify({ json: { invoiceId: 201 } }))}`,
      { headers: cookie(aliceToken) }
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const body = await response.text();
    expect(body).not.toMatch(/"stack"|node_modules/);
  });
});
