// HTTP-level protections: security headers + CSP, CSRF origin checks, body size limits and
// error responses that never expose stack traces, SQL or file paths.
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import { LIMITS } from "./limits";

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy compatible with the real frontend:
 *  - own bundle only (no inline scripts; the theme bootstrap lives in /theme-init.js);
 *  - Google Identity Services + Google API loader (Gmail drafts, Google Drive import);
 *  - inline styles are needed by Radix/shadcn positioning and Google's sign-in widget.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com https://accounts.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com https://www.gstatic.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com https://*.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://www.googleapis.com https://gmail.googleapis.com https://content.googleapis.com https://accounts.google.com https://oauth2.googleapis.com",
  "frame-src 'self' blob: data: https://accounts.google.com https://docs.google.com https://drive.google.com https://content.googleapis.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  );
  // Google sign-in opens a popup that must be able to talk back to this window.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  if (isProduction()) {
    // Vite's dev server needs inline scripts and websockets, so CSP/HSTS are production-only.
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    if (req.secure)
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
  }
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Hosts allowed as Origin besides the request's own host (e.g. "app.example.com,other.example"). */
const extraOrigins = () =>
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);

/**
 * CSRF defence in depth (the session cookie is already SameSite=Lax):
 * state-changing API requests coming from a browser must originate from this site.
 * Requests without Origin/Sec-Fetch-Site (server-to-server, CLI) carry no ambient browser
 * credentials problem and are allowed; they still need a valid session or secret.
 */
export const csrfOriginCheck: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || !req.path.startsWith("/api/"))
    return next();
  const fetchSite = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (fetchSite === "cross-site") {
    res.status(403).json({ error: "Cross-site request blocked" });
    return;
  }
  const origin = req.headers.origin;
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = "";
    }
    const ownHost = String(req.headers.host ?? "").toLowerCase();
    const forwardedHost = String(req.headers["x-forwarded-host"] ?? "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    const allowed =
      Boolean(originHost) &&
      (originHost === ownHost ||
        originHost === forwardedHost ||
        extraOrigins().some(
          item => item === originHost || item === origin.toLowerCase()
        ));
    if (!allowed) {
      res.status(403).json({ error: "Cross-origin request blocked" });
      return;
    }
  }
  // tRPC calls from the app are always JSON; a form-encoded POST is never legitimate here.
  if (req.path.startsWith("/api/trpc")) {
    const type = String(req.headers["content-type"] ?? "");
    if (type && !type.toLowerCase().startsWith("application/json")) {
      res.status(415).json({ error: "Unsupported content type" });
      return;
    }
  }
  next();
};

export function registerBodyParsers(app: Express) {
  // Large bodies only where files are uploaded (tRPC, base64); everything else is tiny.
  app.use("/api/trpc", express.json({ limit: LIMITS.trpcBodyBytes }));
  app.use(express.json({ limit: LIMITS.defaultBodyBytes }));
}

/** Last-resort handler: generic messages for clients, details only in server logs. */
export const safeErrorHandler: ErrorRequestHandler = (
  error,
  req,
  res,
  _next
) => {
  const status = Number(error?.status ?? error?.statusCode ?? 500);
  if (status === 413) {
    res.status(413).json({ error: "Слишком большой запрос" });
    return;
  }
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: "Некорректный запрос" });
    return;
  }
  console.error("[http]", req.method, req.path, error);
  if (!res.headersSent)
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
};

/**
 * Message a client may see for a tRPC error. Our own messages are written in Russian for users;
 * anything else (SQL, driver, file-system, library text) is replaced by a generic phrase.
 */
export function clientSafeMessage(
  code: string,
  message: string,
  cause?: unknown
) {
  if (code !== "INTERNAL_SERVER_ERROR") return message;
  const raw = String((cause as any)?.message ?? message ?? "");
  if (
    /ER_DUP_ENTRY|duplicate entry/i.test(raw) ||
    /ER_DUP_ENTRY|duplicate entry/i.test(message)
  )
    return "Такая запись уже существует";
  const technical =
    /Failed query|ER_[A-Z_]{3,}|ECONN|ETIMEDOUT|ENOENT|EACCES|sqlMessage|select |insert into|update `|delete from|\/(app|home|usr|root|tmp|var)\/|node_modules|at [\w.<>]+ \(|TypeError|ReferenceError|Cannot read prop/i;
  if (
    /[А-Яа-яЁё]/.test(message) &&
    !technical.test(message) &&
    message.length <= 400
  )
    return message;
  return "Внутренняя ошибка сервера. Попробуйте ещё раз или обратитесь к администратору.";
}
