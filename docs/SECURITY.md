# Security architecture

This file is a map for developers: where each protection lives and what must not be bypassed.

## Access model

| Role | Access |
|---|---|
| `admin` | all objects, users, destructive operations |
| `manager` | only objects whose **block** is listed in `users.managedBlocks` |

The block of an object is computed in `server/authz.ts`:

| Object | Block |
|---|---|
| contract | `deriveBlockFolder(propertyName, unitName, blockFolder)` |
| accrual | its contract's block; without a contract, derived from the accrual's own address |
| invoice | visible only if **every** billed accrual is accessible |
| payment | via its invoice |
| document | contract block + per-document rules (`canViewDocument`) |

**Rule:** every tRPC procedure or HTTP route that receives an object ID calls one of
`requireContractAccess`, `requireAccrualAccess`, `requireInvoiceAccess`, `requirePaymentAccess`,
`requireDocumentAccess`, or filters lists with `filterInvoices` / `filterAccruals` / `loadScope`.
Role permissions go through `assertPermission` (throws `FORBIDDEN`). Never rely on the UI.

## Money and races

`server/db.ts`:

- `recordPayment`, `reversePayment`, `updateInvoicePaymentStatus` run in a transaction with
  `SELECT … FOR UPDATE` on the invoice, so concurrent payments cannot overpay.
- `createInvoice` locks the accruals, requires them to be drafts, recomputes the total from the
  locked rows and flips them to `invoiced` atomically. `invoiceItems.accrualId` is unique.
- User edits of accruals use `updateDraftAccrual` / conditional `deleteAccrual` (no edits after invoicing).

## Input and files

- `server/security/limits.ts` holds every size and count limit.
- `server/security/upload.ts`: data URLs are size-checked before decoding, base64 is validated, and the
  file type is taken from the file's own signature (magic bytes), not from the declared MIME type or name.
- `server/security/spreadsheet.ts`: Excel is read with `exceljs` (SheetJS `xlsx` 0.18.5 was removed:
  CVE-2023-30533, CVE-2024-22363). The zip directory is inspected before unpacking
  (decompression bombs); rows, columns and cell length are capped; header names cannot pollute prototypes.
  Only `.xlsx` is accepted.
- OCR (`server/localOcr.ts`): bounded queue, pixel limits for images and rendered PDF pages.

## Authentication

- scrypt password hashes, opaque session tokens (only SHA-256 hashes are stored), HttpOnly + SameSite=Lax cookie, `Secure` in production.
- Login is throttled per account+IP, per account and per IP through the `rateLimits` table
  (`server/security/rateLimit.ts`), which works across several app instances.
- Unknown e-mails are verified against a dummy hash, so response time reveals nothing.
- Sessions are revoked on logout, password change and temporary-password issue; disabled users lose access immediately.

## HTTP

`server/security/http.ts`:

- CSP (production), HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP.
- No CORS headers: the API is same-origin only.
- CSRF defence in depth: cross-site `Origin` / `Sec-Fetch-Site` rejected for state-changing `/api` requests; tRPC accepts only JSON.
- Body limits: 22 MB for `/api/trpc` (uploads), 100 KB elsewhere; tRPC batches are capped at 20 calls.
- Errors: no stack traces in production; technical messages (SQL, paths, drivers) are replaced by a generic text and logged server-side.

## Outbound requests

`server/security/ssrf.ts` (`safeRequest`): HTTPS only, public IPs only, checked inside the socket's DNS
lookup (no DNS-rebinding window), no redirects. Used for storage URLs returned by a remote service.

## Tests

- `server/security.regression.test.ts`: IDOR/BOLA attempts, uploads, Excel, SSRF, brute force, HTTP headers, CSRF, PDF, revoked sessions.
- `server/security.db.integration.test.ts`: concurrent payments, double billing, replayed reversals, shared rate limiter.
  It needs a disposable database:
  `SECURITY_TEST_DATABASE_URL=mysql://user:pass@host:port/db pnpm test`.
