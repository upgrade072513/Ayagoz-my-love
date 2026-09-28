import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthSession: vi.fn(),
  getAuthSessionUser: vi.fn(),
  revokeAuthSession: vi.fn(),
  revokeUserSessions: vi.fn(),
  updateAuthSessionSeen: vi.fn(),
}));

vi.mock("./db", () => mocks);

import {
  authenticateLocalRequest,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from "./localAuth";

const request = (cookie = "") =>
  ({ headers: { cookie }, ip: "127.0.0.1" }) as any;

describe("local authentication security", () => {
  it("normalizes email consistently", () => {
    expect(normalizeEmail("  User@Company.COM ")).toBe("user@company.com");
  });

  it("uses a unique salted scrypt hash", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(await verifyPassword("correct horse battery staple", first)).toBe(
      true
    );
    expect(await verifyPassword("wrong password", first)).toBe(false);
  });

  it("rejects expired, revoked and non-active sessions", async () => {
    mocks.getAuthSessionUser.mockResolvedValueOnce({
      session: {
        id: 1,
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      },
      user: { accountStatus: "active" },
    });
    expect(
      await authenticateLocalRequest(request("app_session_id=expired"))
    ).toBeNull();
    mocks.getAuthSessionUser.mockResolvedValueOnce({
      session: {
        id: 2,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      },
      user: { accountStatus: "active" },
    });
    expect(
      await authenticateLocalRequest(request("app_session_id=revoked"))
    ).toBeNull();
    mocks.getAuthSessionUser.mockResolvedValueOnce({
      session: {
        id: 3,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      },
      user: { accountStatus: "pending" },
    });
    expect(
      await authenticateLocalRequest(request("app_session_id=pending"))
    ).toBeNull();
  });

  it("applies a bounded login rate limit (shared limiter, per account + IP)", async () => {
    const { consume, rateKey, RULES } = await import("./security/rateLimit");
    const key = rateKey(
      "ip-email",
      "203.0.113.9",
      `rate-${Date.now()}@example.com`
    );
    for (let index = 0; index < RULES.loginPerAccountAndIp.limit; index += 1)
      expect((await consume(RULES.loginPerAccountAndIp, key)).allowed).toBe(
        true
      );
    expect((await consume(RULES.loginPerAccountAndIp, key)).allowed).toBe(
      false
    );
  });
});
