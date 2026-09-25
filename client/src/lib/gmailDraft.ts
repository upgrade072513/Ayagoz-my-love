// Gmail draft with the invoice PDF attached.
// Gmail's "compose" links cannot carry attachments, so the letter is created as a DRAFT through the
// Gmail API (scope gmail.compose — the app can only create drafts, it cannot read the mailbox),
// then that draft is opened in Gmail for the user to check and press «Отправить».
// Needs VITE_GOOGLE_CLIENT_ID (Google Cloud → OAuth client, type "Web application").

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
let cachedToken: { value: string; expiresAt: number } | null = null;

const googleOAuth = () => (window as any).google?.accounts?.oauth2;
export const gmailAttachmentsAvailable = () => Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID) && Boolean(googleOAuth());
export const hasFreshGmailToken = () => Boolean(cachedToken && cachedToken.expiresAt > Date.now() + 60_000);

/** Must be called directly from a click handler: the first time Google shows its sign-in / consent window. */
export function getGmailToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return Promise.resolve(cachedToken.value);
  const oauth = googleOAuth();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!oauth || !clientId) return Promise.reject(new Error("Вход через Google не настроен"));
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      callback: (response: any) => {
        if (response?.error || !response?.access_token) return reject(new Error(response?.error_description || response?.error || "Google не выдал доступ"));
        cachedToken = { value: response.access_token, expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000 };
        resolve(response.access_token);
      },
      error_callback: (error: any) => reject(new Error(error?.type === "popup_closed" ? "Окно входа Google было закрыто" : error?.type === "popup_failed_to_open" ? "Браузер заблокировал окно входа Google — разрешите всплывающие окна для сайта" : "Не удалось войти в Google")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

const utf8Base64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};
const bytesBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(binary);
};
const wrap = (base64: string) => base64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
const encodedWord = (text: string) => `=?UTF-8?B?${utf8Base64(text)}?=`;

export function buildMimeMessage(input: { to: string; subject: string; body: string; attachment: ArrayBuffer; fileName: string }) {
  const boundary = `ussh-${Math.random().toString(36).slice(2)}`;
  return [
    `To: ${input.to}`,
    `Subject: ${encodedWord(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(utf8Base64(input.body)),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${encodedWord(input.fileName)}"`,
    `Content-Disposition: attachment; filename="${encodedWord(input.fileName)}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap(bytesBase64(input.attachment)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Creates the draft and returns the Gmail link that opens it. */
export async function createGmailDraft(token: string, input: { to: string; subject: string; body: string; attachment: ArrayBuffer; fileName: string }) {
  const raw = utf8Base64(buildMimeMessage(input)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) cachedToken = null;
  if (!response.ok) throw new Error(`Gmail не создал черновик: ${data?.error?.message ?? response.statusText}`);
  const messageId = data?.message?.id;
  return messageId ? `https://mail.google.com/mail/u/0/#drafts?compose=${messageId}` : "https://mail.google.com/mail/u/0/#drafts";
}

export async function fetchInvoicePdf(invoiceId: number) {
  const response = await fetch(`/api/invoices/${invoiceId}/pdf`, { credentials: "include" });
  if (!response.ok) throw new Error("Не удалось сформировать PDF счёта");
  return response.arrayBuffer();
}

/** Saves the invoice PDF to the computer (used when the mail service cannot receive attachments by link). */
export function downloadInvoicePdf(invoiceId: number) {
  const link = document.createElement("a");
  link.href = `/api/invoices/${invoiceId}/pdf?download=1`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
