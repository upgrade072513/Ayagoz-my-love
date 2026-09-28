// Invoice as a PDF file: attached to emails and available for download.
import { existsSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { Express } from "express";
import { invoiceDueDateText, PAYMENT_OPTIONS } from "@shared/invoice";
import { authenticateLocalRequest } from "./localAuth";
import { requireInvoiceAccess } from "./authz";
import { consume, rateKey, RULES } from "./security/rateLimit";

const firstExisting = (...candidates: string[]) =>
  candidates.find(candidate => existsSync(candidate));
const asset = (...parts: string[]) =>
  firstExisting(
    path.resolve(process.cwd(), ...parts),
    path.resolve(process.cwd(), "..", ...parts)
  );
const FONT_REGULAR = () => asset("server", "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = () =>
  asset("server", "assets", "fonts", "DejaVuSans-Bold.ttf");
const LOGO = () =>
  firstExisting(
    path.resolve(process.cwd(), "dist", "public", "logo.png"),
    path.resolve(process.cwd(), "client", "public", "logo.png")
  );

const money = (value: unknown) =>
  `${Number(value ?? 0)
    .toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(/ | /g, " ")} ₸`;
const dateText = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value ?? "")
    : date.toLocaleDateString("ru-RU", { timeZone: "UTC" });
};

export type InvoiceForPdf = {
  invoiceNumber: string;
  issueDate: unknown;
  period: string;
  tenantName: string;
  totalAmount: unknown;
};
export type InvoiceItemForPdf = { description: string; amount: unknown };

export function buildInvoicePdf(
  invoice: InvoiceForPdf,
  items: InvoiceItemForPdf[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 56,
      info: {
        Title: `Счёт ${invoice.invoiceNumber}`,
        Author: "University Service Management",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const regular = FONT_REGULAR();
    const bold = FONT_BOLD();
    if (!regular || !bold) return reject(new Error("Шрифт для PDF не найден"));
    doc.registerFont("regular", regular);
    doc.registerFont("bold", bold);
    const gold = "#9a7633";
    const ink = "#1c1c1e";
    const muted = "#6e6e73";
    const line = "#e5e5ea";
    const left = doc.page.margins.left;
    const width =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const logo = LOGO();
    if (logo) doc.image(logo, left, 48, { height: 46 });
    doc
      .font("regular")
      .fontSize(9)
      .fillColor(muted)
      .text("УСЛУГИ ПРОЖИВАНИЯ (ФИЗИЧЕСКИЕ ЛИЦА)", left, 112, {
        characterSpacing: 1.2,
      });
    doc
      .font("bold")
      .fontSize(24)
      .fillColor(ink)
      .text("Счёт на оплату", left, 128);
    doc
      .font("bold")
      .fontSize(11)
      .fillColor(ink)
      .text(invoice.invoiceNumber, left, 56, { width, align: "right" });
    doc
      .font("regular")
      .fontSize(10)
      .fillColor(muted)
      .text(`от ${dateText(invoice.issueDate)}`, left, 72, {
        width,
        align: "right",
      })
      .text(`Период: ${invoice.period}`, { width, align: "right" })
      .text(`Оплатить до: ${invoiceDueDateText(invoice.period)}`, {
        width,
        align: "right",
      });

    let y = 176;
    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .strokeColor(line)
      .lineWidth(1)
      .stroke();
    y += 18;
    doc
      .font("regular")
      .fontSize(9)
      .fillColor(muted)
      .text("ПЛАТЕЛЬЩИК", left, y)
      .text("К ОПЛАТЕ", left, y, { width, align: "right" });
    doc
      .font("bold")
      .fontSize(14)
      .fillColor(ink)
      .text(invoice.tenantName, left, y + 14, { width: width * 0.6 });
    doc
      .font("bold")
      .fontSize(18)
      .fillColor(gold)
      .text(money(invoice.totalAmount), left, y + 12, {
        width,
        align: "right",
      });
    y += 56;
    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .strokeColor(line)
      .stroke();

    y += 18;
    doc
      .font("regular")
      .fontSize(9)
      .fillColor(muted)
      .text("УСЛУГИ", left, y)
      .text("СУММА", left, y, { width, align: "right" });
    y += 18;
    for (const item of items) {
      const height = doc
        .font("regular")
        .fontSize(10.5)
        .heightOfString(item.description, { width: width - 140 });
      doc
        .fillColor(ink)
        .text(item.description, left, y, { width: width - 140 });
      doc
        .font("bold")
        .text(money(item.amount), left, y, { width, align: "right" });
      y += Math.max(height, 14) + 10;
      doc
        .moveTo(left, y - 5)
        .lineTo(left + width, y - 5)
        .strokeColor(line)
        .stroke();
    }
    y += 8;
    doc
      .font("regular")
      .fontSize(10)
      .fillColor(muted)
      .text("Итого", left, y, { width, align: "right" });
    doc
      .font("bold")
      .fontSize(20)
      .fillColor(ink)
      .text(money(invoice.totalAmount), left, y + 14, {
        width,
        align: "right",
      });
    y += 56;

    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .strokeColor(line)
      .stroke();
    y += 16;
    doc
      .font("regular")
      .fontSize(9)
      .fillColor(muted)
      .text("СПОСОБЫ ОПЛАТЫ / PAYMENT OPTIONS", left, y);
    y += 16;
    PAYMENT_OPTIONS.forEach((option, index) => {
      doc
        .font("bold")
        .fontSize(10)
        .fillColor(ink)
        .text(`${index + 1}. ${option.title}`, left, y, { continued: true })
        .font("regular")
        .fillColor(muted)
        .text(` — ${option.detail}`);
      y = doc.y + 6;
    });
    doc
      .font("regular")
      .fontSize(8.5)
      .fillColor(muted)
      .text(
        "Срок оплаты — не позднее 10 числа месяца оказания услуг. Если данные счёта указаны неверно, сообщите ответственному менеджеру.",
        left,
        doc.page.height - 90,
        { width }
      );
    doc.end();
  });
}

export const invoicePdfFileName = (invoiceNumber: string) =>
  `Счёт ${invoiceNumber}.pdf`;

/** GET /api/invoices/:id/pdf — signed-in staff with access to the invoice's block only. */
export function registerInvoicePdfRoute(app: Express) {
  app.get("/api/invoices/:id/pdf", async (req, res) => {
    try {
      const user = await authenticateLocalRequest(req).catch(() => null);
      if (!user) return res.status(401).send("Unauthorized");
      if (user.mustChangePassword)
        return res.status(403).send("Сначала замените временный пароль");
      if (!/^[1-9]\d{0,9}$/.test(String(req.params.id)))
        return res.status(400).send("Некорректный номер счёта");
      const limit = await consume(RULES.pdfRender, rateKey("user", user.id));
      if (!limit.allowed) return res.status(429).send("Слишком много запросов");
      let access;
      try {
        access = await requireInvoiceAccess(user, Number(req.params.id));
      } catch (error) {
        const code = (error as any)?.code;
        return code === "NOT_FOUND"
          ? res.status(404).send("Счёт не найден")
          : res.status(403).send("Нет доступа к счёту");
      }
      const { invoice, items } = access;
      const pdf = await buildInvoicePdf(
        invoice as InvoiceForPdf,
        items as InvoiceItemForPdf[]
      );
      const name = invoicePdfFileName(invoice.invoiceNumber);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${req.query.download ? "attachment" : "inline"}; filename="invoice-${invoice.invoiceNumber.replace(/[^\w.-]+/g, "_")}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`
      );
      res.setHeader("Cache-Control", "no-store");
      res.send(pdf);
    } catch (error) {
      console.error("[invoice-pdf]", error);
      res.status(500).send("Не удалось сформировать PDF");
    }
  });
}
