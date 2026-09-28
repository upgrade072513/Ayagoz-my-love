import { describe, expect, it } from "vitest";
import { canViewDocument } from "./access";

describe("document access policy", () => {
  const contract = { departmentId: 7 };
  it("allows administrators to see every document", () => {
    expect(
      canViewDocument(
        { id: 1, role: "admin", departmentId: null },
        { departmentId: 99 },
        []
      )
    ).toBe(true);
  });
  it("uses an explicit user rule before department fallback", () => {
    expect(
      canViewDocument({ id: 1, role: "manager", departmentId: 7 }, contract, [
        { userId: 1, canView: "no" },
        { departmentId: 7, canView: "yes" },
      ])
    ).toBe(false);
    expect(
      canViewDocument({ id: 1, role: "manager", departmentId: 7 }, contract, [
        { userId: 1, canView: "yes" },
      ])
    ).toBe(true);
  });
  it("allows department members by explicit department rule or contract department", () => {
    expect(
      canViewDocument({ id: 1, role: "manager", departmentId: 7 }, contract, [])
    ).toBe(true);
    expect(
      canViewDocument({ id: 1, role: "manager", departmentId: 8 }, contract, [
        { departmentId: 8, canView: "yes" },
      ])
    ).toBe(true);
    expect(
      canViewDocument({ id: 1, role: "manager", departmentId: 8 }, contract, [])
    ).toBe(false);
  });
});
