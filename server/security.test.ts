import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./localAuth";

describe("password hashing", () => {
  it("hashes passwords and verifies only the matching password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).toMatch(/^scrypt\$/);
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(
      true
    );
    expect(await verifyPassword("wrong password", encoded)).toBe(false);
    expect(encoded).not.toContain("correct horse");
  });

  it("does not persist plaintext password in the password hash", async () => {
    const encoded = await hashPassword("a sufficiently long password");
    expect(encoded).not.toContain("a sufficiently long password");
  });
});
