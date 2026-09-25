import { describe, expect, it } from "vitest";
import { buildMimeMessage } from "./gmailDraft";

describe("Gmail draft MIME", () => {
  it("contains the letter text and the PDF as an attachment with a Cyrillic file name", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 test").buffer;
    const mime = buildMimeMessage({ to: "ivan@nu.edu.kz", subject: "Счёт INV-1", body: "Здравствуйте!", attachment: pdf, fileName: "Счёт INV-1.pdf" });
    expect(mime).toContain("To: ivan@nu.edu.kz");
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(mime).toContain("Content-Type: application/pdf");
    expect(mime).toContain("Content-Disposition: attachment");
    expect(mime).toContain(btoa("%PDF-1.4 test"));
    expect(/[^\x00-\x7f]/.test(mime)).toBe(false);
  });
});
