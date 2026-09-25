import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getUserByEmailNormalized: vi.fn(),
  getUserById: vi.fn(),
  createLocalUser: vi.fn(),
  updateUserLocalAuth: vi.fn(),
  createSecurityAuditEvent: vi.fn(),
  createAuthSession: vi.fn(),
  getAuthSessionUser: vi.fn(),
  revokeAuthSession: vi.fn(),
  revokeUserSessions: vi.fn(),
  updateAuthSessionSeen: vi.fn(),
  listContracts: vi.fn(async () => []),
}));

vi.mock("./db", () => db);

import { appRouter } from "./routers";
import { generateTemporaryPassword, verifyPassword } from "./localAuth";

const admin = { id: 1, role: "admin", accountStatus: "active", mustChangePassword: false } as any;
const ctxFor = (user: any) => ({ user, req: { ip: "10.0.0.1", headers: {}, get: () => "" }, res: { cookie: vi.fn(), clearCookie: vi.fn() } }) as any;

describe("one-time password for new employees", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates readable 14-character passwords without look-alike characters", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{4}-[A-HJ-NP-Za-km-np-z2-9]{4}-[A-HJ-NP-Za-km-np-z2-9]{4}$/);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
  });

  it("creates an active account whose stored hash matches the returned one-time password", async () => {
    db.getUserByEmailNormalized.mockResolvedValue(undefined);
    db.createLocalUser.mockImplementation(async (input: any) => ({ id: 42, ...input, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }));
    const result = await appRouter.createCaller(ctxFor(admin)).admin.createUser({ name: "Акмарал", email: "New.User@nu.edu.kz", role: "manager", managedBlocks: ["Блок А4"] });
    const saved = db.createLocalUser.mock.calls[0][0];
    expect(saved).toMatchObject({ emailNormalized: "new.user@nu.edu.kz", accountStatus: "active", mustChangePassword: true });
    expect(saved).not.toHaveProperty("openId");
    expect(await verifyPassword(result.temporaryPassword, saved.passwordHash)).toBe(true);
    expect(result.temporaryPasswordExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(db.createSecurityAuditEvent.mock.calls)).not.toContain(result.temporaryPassword);
  });

  it("lets an administrator re-issue a one-time password for an employee who never set one", async () => {
    db.getUserById.mockResolvedValue({ id: 7, email: "m@nu.edu.kz", accountStatus: "pending", passwordHash: null });
    const result = await appRouter.createCaller(ctxFor(admin)).admin.issueTemporaryPassword({ userId: 7 });
    const patch = db.updateUserLocalAuth.mock.calls[0][1];
    expect(patch).toMatchObject({ mustChangePassword: true, accountStatus: "active" });
    expect(await verifyPassword(result.temporaryPassword, patch.passwordHash)).toBe(true);
    expect(db.revokeUserSessions).toHaveBeenCalledWith(7);
  });

  it("rejects an expired one-time password at sign-in", async () => {
    const { hashPassword } = await import("./localAuth");
    db.getUserByEmailNormalized.mockResolvedValue({ id: 7, accountStatus: "active", passwordHash: await hashPassword("Abcd-Efgh-Jkmn"), mustChangePassword: true, temporaryPasswordExpiresAt: new Date(Date.now() - 1000) });
    await expect(appRouter.createCaller(ctxFor(null)).auth.login({ email: "m@nu.edu.kz", password: "Abcd-Efgh-Jkmn" })).rejects.toThrow("временного пароля истёк");
    expect(db.createAuthSession).not.toHaveBeenCalled();
  });

  it("blocks everything except the password change until the one-time password is replaced", async () => {
    const user = { id: 7, role: "manager", accountStatus: "active", mustChangePassword: true, managedBlocks: "[]" } as any;
    await expect(appRouter.createCaller(ctxFor(user)).contracts.list()).rejects.toThrow("временный пароль");
    await expect(appRouter.createCaller(ctxFor({ ...user, role: "admin" })).admin.users()).rejects.toThrow("временный пароль");
  });

  it("clears the one-time flag after the employee sets a personal password", async () => {
    const { hashPassword } = await import("./localAuth");
    const user = { id: 7, role: "manager", accountStatus: "active", mustChangePassword: true, passwordHash: await hashPassword("Abcd-Efgh-Jkmn") } as any;
    await appRouter.createCaller(ctxFor(user)).auth.changePassword({ currentPassword: "Abcd-Efgh-Jkmn", newPassword: "my own long password", confirmPassword: "my own long password" });
    expect(db.updateUserLocalAuth.mock.calls[0][1]).toMatchObject({ mustChangePassword: false, temporaryPasswordExpiresAt: null });
  });
});
