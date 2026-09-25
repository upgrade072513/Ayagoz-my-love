import { describe, expect, it } from "vitest";
import { canViewDocument } from "./access";

describe("two-role document access", () => {
  it("gives administrator access across departments", () => {
    expect(canViewDocument({ id: 1, role: "admin", departmentId: null }, { departmentId: 99 }, [])).toBe(true);
  });

  it("gives manager access only to the assigned department", () => {
    const manager = { id: 2, role: "manager", departmentId: 10 } as const;
    expect(canViewDocument(manager, { departmentId: 10 }, [])).toBe(true);
    expect(canViewDocument(manager, { departmentId: 11 }, [])).toBe(false);
  });

  it("allows a confidential-document exception for a manager", () => {
    const manager = { id: 2, role: "manager", departmentId: 10 } as const;
    expect(canViewDocument(manager, { departmentId: 11 }, [{ userId: 2, canView: "yes" }])).toBe(true);
    expect(canViewDocument(manager, { departmentId: 10 }, [{ userId: 2, canView: "no" }])).toBe(false);
  });
});
