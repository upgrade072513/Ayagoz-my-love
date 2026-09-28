// Express app assembly (shared by the real server and the HTTP security tests).
import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import {
  csrfOriginCheck,
  registerBodyParsers,
  safeErrorHandler,
  securityHeaders,
} from "../security/http";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { archiveExpiredContractsHandler } from "../scheduled";
import { registerInvoicePdfRoute } from "../invoicePdf";

/** Security middleware + every API route. The frontend is mounted afterwards by the caller. */
export function registerApi(app: Express) {
  app.disable("x-powered-by");
  // Railway (and most PaaS) terminate TLS at a proxy: trust exactly one hop so req.ip / req.protocol are real.
  app.set("trust proxy", 1);
  app.use(securityHeaders);
  app.use(csrfOriginCheck);
  registerBodyParsers(app);
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  registerInvoicePdfRoute(app);
  app.post(
    "/api/scheduled/archive-expired-contracts",
    archiveExpiredContractsHandler
  );
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      // One HTTP request may carry at most 20 procedure calls (the client sends at most 10).
      maxBatchSize: 20,
      onError({ error, path }) {
        if (error.code === "INTERNAL_SERVER_ERROR")
          console.error(`[trpc] ${path ?? "?"}:`, error.cause ?? error);
      },
    })
  );
  // Unknown API paths are 404 JSON, never the SPA.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
}

/** API-only app (tests). */
export function createApiApp() {
  const app = express();
  registerApi(app);
  app.use(safeErrorHandler);
  return app;
}

export { safeErrorHandler };
