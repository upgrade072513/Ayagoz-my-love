import { describe, expect, it } from "vitest";
import { hasPermission, ROLE_LABELS } from "@shared/accessControl";

describe("access control matrix", () => {
  it("exposes all supported roles", () => {
    expect(Object.keys(ROLE_LABELS)).toEqual(["admin", "manager"]);
  });
  it("keeps unsupported roles away from mutations", () => {
    expect(hasPermission("legacy", "manageContracts")).toBe(false);
    expect(hasPermission("legacy", "managePayments")).toBe(false);
    expect(hasPermission("manager", "manageContracts")).toBe(true);
    expect(hasPermission("admin", "destructive")).toBe(true);
  });
  it("rejects unsupported roles", () => {
    expect(hasPermission("legacy", "manageContracts")).toBe(false);
  });
});
