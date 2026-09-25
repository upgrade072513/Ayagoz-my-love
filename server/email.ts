import { invoiceDueDateText, PAYMENT_OPTIONS } from "@shared/invoice";

export type InvoiceEmailItem = { description: string; amount: string | number };

export type InvoiceEmailInput = {
  invoiceNumber: string;
  tenantName: string;
  recipient: string;
  period: string;
  totalAmount: string | number;
  items: InvoiceEmailItem[];
};

const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#039;");

const money = (value: unknown) => `${Number(value ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`;

export function buildInvoiceEmail(input: InvoiceEmailInput) {
  const dueDateLabel = invoiceDueDateText(input.period);
  const dueDate = `${input.period}-10`;
  const itemRows = input.items.map(item => `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">${escapeHtml(item.description)}</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${escapeHtml(money(item.amount))}</td></tr>`).join("");
  const paymentHtml = PAYMENT_OPTIONS.map((option, index) => `<li><strong>${index + 1}. ${escapeHtml(option.title)}</strong> — ${escapeHtml(option.detail)}</li>`).join("");
  const subject = `Счёт ${input.invoiceNumber} — Услуги проживания (физ лица)`;
  const html = `<div style="font-family:Arial,sans-serif;color:#3f3f3f;line-height:1.5;max-width:680px"><h2 style="color:#9a7633">Услуги проживания (физ лица)</h2><p>Здравствуйте, ${escapeHtml(input.tenantName)}.</p><p>Направляем счёт <strong>${escapeHtml(input.invoiceNumber)}</strong> за период <strong>${escapeHtml(input.period)}</strong>.</p><p><strong>Срок оплаты: не позднее ${escapeHtml(dueDateLabel)}.</strong></p><table style="width:100%;border-collapse:collapse"><tbody>${itemRows}</tbody><tfoot><tr><td style="padding-top:14px;font-weight:700">Итого</td><td style="padding-top:14px;text-align:right;font-size:18px;font-weight:700">${escapeHtml(money(input.totalAmount))}</td></tr></tfoot></table><h3 style="margin-top:24px">Payment Options</h3><ol>${paymentHtml}</ol><p style="margin-top:24px;color:#6b7280">Если адрес получателя или данные счёта указаны неверно, сообщите, пожалуйста, ответственному менеджеру.</p></div>`;
  const text = [`Услуги проживания (физ лица)`, `Счёт: ${input.invoiceNumber}`, `Плательщик: ${input.tenantName}`, `Период: ${input.period}`, `Срок оплаты: не позднее ${dueDateLabel}`, `Итого: ${money(input.totalAmount)}`, "", "Payment Options:", ...PAYMENT_OPTIONS.map((option, index) => `${index + 1}. ${option.title} — ${option.detail}`)].join("\n");
  return { subject, html, text, dueDate, dueDateLabel };
}
