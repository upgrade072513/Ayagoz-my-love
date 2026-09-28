import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import { storagePut } from "./storage";
import { calculateAccrual } from "@shared/accrual";
import {
  contracts,
  documents,
  accruals,
  invoices,
  invoiceItems,
  type User,
} from "../drizzle/schema";
import {
  createAccrual,
  createContract,
  createDocument,
  createInvoice,
  deleteAccrual,
  deleteDocument,
  getContract,
  getDocument,
  getInvoice,
  getInvoiceItems,
  listAccruals,
  listContracts,
  listDocuments,
  listInvoices,
  listContractFolders,
  createContractFolder,
  renameContractFolder,
  deleteContractFolder,
  moveContractsToFolder,
  markAccrualsInvoiced,
  updateAccrual,
  updateDraftAccrual,
  updateContract,
  updateInvoiceEmail,
  permanentlyDeleteContract,
  permanentlyDeleteContracts,
  listPermanentlyDeletableContractIds,
} from "./db";
import { decryptContractFile, encryptContractFile } from "./fileCrypto";
import { storageRead } from "./storage";
import * as dbHelpers from "./db";
import { parseContractsExcel } from "./excelImport";
import { parsePaymentsExcel } from "./paymentImport";
import { buildAccrualWorkbook } from "./excelExport";
import { toDateOnly } from "@shared/dateOnly";
import { canAccessContractBlock, canViewDocument } from "@shared/access";
import { hasPermission, type Permission } from "@shared/accessControl";

/** Role check that yields a proper 403 (FORBIDDEN) instead of a generic server error. */
function assertPermission(
  role: string,
  permission: Permission,
  message?: string
) {
  if (!hasPermission(role, permission))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: message ?? "Недостаточно прав для выполнения операции",
    });
}
import { deriveBlockFolder } from "@shared/contractFolder";
import { invokeLLM, listLLMModels } from "./_core/llm";
import { getOcrProvider, OCR_FIELDS_PROMPT } from "./ocr";
import {
  identityFromFileName,
  mergeWithFileName,
  recognizeLocally,
} from "./localOcr";
import { buildInvoiceEmail } from "./email";
import { createHash, randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  type Actor,
  canAccessContract,
  canAccessBlock,
  filterAccruals,
  filterInvoices,
  loadScope,
  requireAccrualAccess,
  requireBlock,
  requireContractAccess as requireContractById,
  requireDocumentAccess,
  requireInvoiceAccess,
  requirePaymentAccess,
} from "./authz";
import { LIMITS } from "./security/limits";
import {
  MIME_BY_KIND,
  cleanDisplayFileName,
  decodeScanUpload,
  decodeSpreadsheetUpload,
  storageSafeName,
} from "./security/upload";
import {
  consume,
  enforce,
  peek as peekRateLimit,
  rateKey,
  reset as resetRateLimit,
  RULES,
} from "./security/rateLimit";
import { readFirstSheetMatrix } from "./security/spreadsheet";
import {
  establishSession,
  generateTemporaryPassword,
  hashPassword,
  normalizeEmail,
  revokeCurrentSession,
  revokeAllUserSessions,
  DUMMY_PASSWORD_HASH,
  requestIp,
  TEMPORARY_PASSWORD_TTL_MS,
  verifyPassword,
} from "./localAuth";

const isTestRuntime = process.argv.some(arg => arg.includes("vitest"));
const sanitizeAuthUser = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  departmentId: user.departmentId,
  managedBlocks: user.managedBlocks,
  accountStatus: user.accountStatus,
  mustChangePassword: Boolean(user.mustChangePassword),
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastSignedIn: user.lastSignedIn,
});

const recordContractAudit = async (input: any) => {
  if (!Object.prototype.hasOwnProperty.call(dbHelpers, "createContractAudit"))
    return;
  await dbHelpers.createContractAudit(input);
};
const shouldReopenContract = (contract: {
  status?: string;
  endDate?: string | null;
  terminationDate?: string | null;
}) =>
  contract.status === "active" &&
  !contract.terminationDate &&
  !!contract.endDate &&
  contract.endDate > new Date().toISOString().slice(0, 10);
// Authorization lives in ./authz (single source of truth for block-based access).
const canManageContract = (
  user: Actor,
  contract: Parameters<typeof canAccessContract>[1]
) => canAccessContract(user, contract);
const requireContractAccess = (
  user: Actor,
  contract: Parameters<typeof canAccessContract>[1]
) => {
  if (!canAccessContract(user, contract))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Нет доступа к договору: блок не назначен менеджеру",
    });
};
const requireBlockAccess = (
  user: Actor,
  blockFolder: string | null | undefined
) => requireBlock(user, blockFolder);
const scopeAccrualRows = <
  T extends Parameters<typeof filterAccruals>[1][number],
>(
  user: Actor,
  rows: T[]
) => filterAccruals(user, rows);

// Shared input bounds (DoS / overflow / NaN protection).
const money = z.number().finite().positive().max(LIMITS.maxAmount);
const shortText = (max: number = LIMITS.shortText) => z.string().max(max);
const idSchema = z.number().int().positive();
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const isoDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  .refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Некорректная дата");
const dataUrlSchema = (maxBytes: number) =>
  z
    .string()
    .min(20)
    .max(Math.ceil((maxBytes * 4) / 3) + 200);
const fileNameSchema = z.string().trim().min(1).max(LIMITS.fileName);

const IMPORT_COLUMNS = [
  "contractNumber",
  "contractDate",
  "tenantName",
  "tenantContact",
  "tenantEmail",
  "propertyName",
  "unitName",
  "startDate",
  "endDate",
  "tariffType",
  "tariffAmount",
  "status",
  "notes",
] as const;
const standaloneValues = (row: {
  period: string;
  serviceFrom: string;
  serviceTo: string;
  quantity: number;
  amount: number;
  tenantName: string;
  tenantEmail?: string;
  tenantCategory?: string;
  tenantNumber?: string;
  propertyName: string;
  unitName?: string;
  tariffType: "monthly" | "daily";
  tariffAmount: number;
  notes?: string;
}) => ({
  contractId: null,
  period: row.period,
  serviceFrom: new Date(`${row.serviceFrom}T00:00:00Z`),
  serviceTo: new Date(`${row.serviceTo}T00:00:00Z`),
  quantity: row.quantity.toFixed(2),
  amount: row.amount.toFixed(2),
  tenantName: row.tenantName,
  tenantEmail: row.tenantEmail?.trim() || null,
  tenantCategory: row.tenantCategory?.trim() || null,
  tenantNumber: row.tenantNumber?.trim() || null,
  propertyName: row.propertyName,
  unitName: row.unitName?.trim() || null,
  tariffType: row.tariffType,
  tariffAmount: row.tariffAmount.toFixed(2),
  notes: row.notes?.trim() || null,
  status: "draft" as const,
});
/** Unique invoice number; the database's unique index is the final guard, collisions are retried. */
async function createInvoiceWithNumber(
  data: Omit<Parameters<typeof createInvoice>[0], "invoiceNumber">,
  items: Parameters<typeof createInvoice>[1]
) {
  for (let attempt = 0; ; attempt++) {
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;
    try {
      return await createInvoice({ ...data, invoiceNumber }, items);
    } catch (error) {
      const duplicate = /duplicate entry|ER_DUP_ENTRY/i.test(
        String((error as any)?.cause?.message ?? (error as any)?.message ?? "")
      );
      if (
        !duplicate ||
        attempt >= 4 ||
        !/invoiceNumber/i.test(
          String((error as any)?.cause?.message ?? (error as any)?.message)
        )
      )
        throw error;
    }
  }
}

/** E-mail recipients of an invoice, taken from its accruals' contracts (or the accrual itself). */
async function invoiceRecipients(items: Array<{ accrualId: number }>) {
  const accrualRows = await dbHelpers.listAccrualsByIds(
    items.map(item => item.accrualId)
  );
  const contractsById = new Map(
    (await listContracts(true)).map(contract => [contract.id, contract])
  );
  return Array.from(
    new Set(
      accrualRows
        .map(accrual =>
          accrual.contractId == null
            ? accrual.tenantEmail?.trim()
            : contractsById.get(accrual.contractId)?.tenantEmail?.trim()
        )
        .filter((email): email is string => Boolean(email))
    )
  );
}

/** Messages shown to users: our own (Russian) messages pass, anything technical is replaced. */
function publicErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return /[А-Яа-яЁё]/.test(message) && message.length < 300
    ? message
    : fallback;
}

const isRaceSkip = (error: unknown) => {
  const text = `${(error as any)?.message ?? ""} ${(error as any)?.cause?.message ?? ""}`;
  return /нельзя изменять|ER_DUP_ENTRY|duplicate entry/i.test(text);
};

/** Business rule kept from before: accruals without a contract are deleted by an Administrator only. */
function assertCanDeleteAccrual(
  user: Actor,
  accrual: { status: string; contractId: number | null }
) {
  if (accrual.status === "invoiced")
    throw new Error("Начисление в счёте нельзя удалить");
  if (accrual.contractId == null && user.role !== "admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Бездоговорное начисление может удалить только Administrator",
    });
}

const optionalEmail = z
  .union([z.string().trim().email("Укажите корректный Email"), z.literal("")])
  .optional();
const ensureUniqueContractNumber = async (
  contractNumber: string | undefined,
  excludeId?: number
) => {
  const displayNumber = contractNumber?.trim() ?? "";
  const normalized = displayNumber.toLocaleLowerCase();
  if (!normalized) return;
  const duplicate = (await listContracts()).find(
    item =>
      item.id !== excludeId &&
      item.contractNumber?.trim().toLocaleLowerCase() === normalized
  );
  if (duplicate)
    throw new Error(`Договор с номером «${displayNumber}» уже существует`);
};
const recalculateDraftAccrualsForContract = async (contract: any) => {
  const rows = (await listAccruals()).filter(
    row =>
      row.contractId === contract.id &&
      row.status === "draft" &&
      !row.amountEdited
  );
  for (const row of rows) {
    const result = calculateAccrual(
      {
        startDate: toDateOnly(contract.startDate),
        endDate: toDateOnly(contract.endDate),
        terminationDate: contract.terminationDate
          ? toDateOnly(contract.terminationDate)
          : null,
        tariffType: contract.tariffType,
        tariffAmount: Number(contract.tariffAmount),
      },
      row.period
    );
    if (!result) {
      await deleteAccrual(row.id);
      continue;
    }
    // Draft-only update: an accrual invoiced in the meantime is left untouched.
    await updateDraftAccrual(row.id, {
      serviceFrom: new Date(result.serviceFrom + "T00:00:00Z"),
      serviceTo: new Date(result.serviceTo + "T00:00:00Z"),
      quantity: result.quantity.toFixed(2),
      amount: result.amount.toFixed(2),
      tenantName: contract.tenantName,
      tenantEmail: contract.tenantEmail ?? null,
      tenantCategory: contract.tenantCategory ?? null,
      tenantNumber: contract.tenantNumber ?? null,
      propertyName: contract.propertyName,
      unitName: contract.unitName ?? null,
      tariffType: contract.tariffType,
      tariffAmount: String(contract.tariffAmount),
    }).catch(() => undefined);
  }
  return rows.length;
};
const paymentImportRowInput = z.object({
  invoiceNumber: z.string().trim().min(1).max(120),
  amount: money,
  paidAt: isoDate,
  method: z.enum(["bank", "portal", "card", "cash", "other"]),
  reference: z.string().max(255).optional(),
  note: z.string().max(2000).optional(),
});

const standaloneAccrualInput = z
  .object({
    period: periodSchema,
    serviceFrom: isoDate,
    serviceTo: isoDate,
    tenantName: z.string().trim().min(1).max(255),
    tenantEmail: optionalEmail,
    tenantCategory: z.string().trim().max(120).optional(),
    tenantNumber: z.string().trim().max(120).optional(),
    propertyName: z.string().trim().min(1).max(255),
    unitName: z.string().trim().max(120).optional(),
    tariffType: z.enum(["monthly", "daily"]),
    tariffAmount: money,
    quantity: z.number().finite().positive().max(100_000),
    amount: money,
    notes: z.string().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.serviceFrom > value.serviceTo)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceTo"],
        message: "Дата окончания не может быть раньше даты начала",
      });
    if (!value.period.startsWith(value.serviceFrom.slice(0, 7)))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["period"],
        message: "Период должен соответствовать дате начала",
      });
  });

export const contractInput = z
  .object({
    contractNumber: z.string().trim().max(120).optional(),
    contractDate: isoDate.optional(),
    tenantName: z.string().trim().min(1).max(255),
    tenantContact: z.string().max(255).optional(),
    tenantEmail: optionalEmail,
    tenantCategory: z.string().trim().max(120).optional(),
    tenantNumber: z.string().trim().max(120).optional(),
    propertyName: z.string().trim().min(1).max(255),
    unitName: z.string().max(120).optional(),
    startDate: isoDate,
    endDate: isoDate,
    terminationDate: z.preprocess(
      value => (value === "" ? undefined : value),
      isoDate.optional()
    ),
    terminationReason: z.string().trim().max(2000).optional(),
    blockFolder: z.string().trim().max(120).optional(),
    tariffType: z.enum(["monthly", "daily"]),
    tariffAmount: money,
    status: z.enum(["active", "paused", "ended"]).default("active"),
    notes: z.string().max(LIMITS.longText).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate > value.endDate)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "Дата начала не может быть позже даты окончания",
      });
    const today = new Date().toISOString().slice(0, 10);
    if (
      value.status === "ended" &&
      !value.terminationDate &&
      value.endDate >= today
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message:
          "Для завершённого договора укажите дату окончания или планируемую дату расторжения",
      });
    if (
      value.status !== "ended" &&
      !value.terminationDate &&
      value.endDate < today
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message:
          "Договор с прошедшей датой окончания нужно отметить как завершённый",
      });
  })
  .superRefine((value, ctx) => {
    if (value.terminationDate && value.terminationDate < value.startDate)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["terminationDate"],
        message: "Дата расторжения не может быть раньше даты начала",
      });
    if (value.terminationDate && value.terminationDate > value.endDate)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["terminationDate"],
        message: "Дата расторжения не может быть позже даты окончания договора",
      });
  });

const scanResultSchema = {
  type: "object",
  properties: {
    contractNumber: { type: ["string", "null"], description: "Номер договора" },
    contractDate: {
      type: ["string", "null"],
      description: "Дата заключения договора в формате YYYY-MM-DD",
    },
    tenantName: {
      type: ["string", "null"],
      description: "Плательщик или арендатор",
    },
    tenantContact: { type: ["string", "null"], description: "Телефон" },
    tenantEmail: {
      type: ["string", "null"],
      description: "Email получателя счета",
    },
    propertyName: {
      type: ["string", "null"],
      description: "Объект размещения",
    },
    unitName: { type: ["string", "null"], description: "Номер помещения" },
    startDate: {
      type: ["string", "null"],
      description: "Дата начала в формате YYYY-MM-DD",
    },
    endDate: {
      type: ["string", "null"],
      description: "Дата окончания в формате YYYY-MM-DD",
    },
    tariffType: {
      type: ["string", "null"],
      enum: ["monthly", "daily", null],
      description: "Только monthly или daily",
    },
    tariffAmount: { type: ["number", "null"], description: "Ставка в тенге" },
    status: {
      type: ["string", "null"],
      enum: ["active", "paused", "ended", null],
    },
    confidence: { type: "number", description: "Общая уверенность от 0 до 1" },
    fieldConfidence: {
      type: "object",
      additionalProperties: { type: "number", minimum: 0, maximum: 1 },
      description:
        "Уверенность отдельно для каждого поля; ключи совпадают с именами полей",
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      description: "Предупреждения и неуверенно распознанные поля",
    },
  },
  required: [
    "contractNumber",
    "contractDate",
    "tenantName",
    "tenantContact",
    "tenantEmail",
    "propertyName",
    "unitName",
    "startDate",
    "endDate",
    "tariffType",
    "tariffAmount",
    "status",
    "confidence",
    "fieldConfidence",
    "warnings",
  ],
  additionalProperties: false,
} as const;

const scanResultValidator = z.object({
  contractNumber: z.string().nullable().optional().default(null),
  contractDate: z.string().nullable().optional().default(null),
  tenantName: z.string().nullable(),
  tenantContact: z.string().nullable(),
  tenantEmail: z.string().nullable(),
  propertyName: z.string().nullable(),
  unitName: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  tariffType: z.enum(["monthly", "daily"]).nullable(),
  tariffAmount: z.number().nullable(),
  status: z.enum(["active", "paused", "ended"]).nullable(),
  confidence: z.number().min(0).max(1),
  fieldConfidence: z.record(z.string(), z.number().min(0).max(1)).default({}),
  warnings: z.array(z.string()),
});

const isOcrCapacityError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b412\b|\b429\b|precondition failed|usage exhaustion|quota|rate.?limit|capacity)/i.test(
    message
  );
};
const parseScanIdentity = (fileName?: string) => {
  const fromName = identityFromFileName(fileName);
  if (fromName.contractNumber)
    return {
      contractNumber: fromName.contractNumber,
      contractDate: fromName.contractDate,
    };
  const baseName = String(fileName ?? "")
    .replace(/\.[^.]+$/, "")
    .trim();
  const withDate = baseName.match(
    /^(.*?)\s+(?:от|from)\s+(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i
  );
  if (withDate) {
    const year = withDate[4].length === 2 ? `20${withDate[4]}` : withDate[4];
    return {
      contractNumber: withDate[1].replace(/^№\s*/i, "").trim() || null,
      contractDate: `${year}-${withDate[3].padStart(2, "0")}-${withDate[2].padStart(2, "0")}`,
    };
  }
  const withIsoDate = baseName.match(
    /^(.*?)\s+(?:от|from)\s+(\d{4})-(\d{1,2})-(\d{1,2})/i
  );
  if (withIsoDate)
    return {
      contractNumber: withIsoDate[1].replace(/^№\s*/i, "").trim() || null,
      contractDate: `${withIsoDate[2]}-${withIsoDate[3].padStart(2, "0")}-${withIsoDate[4].padStart(2, "0")}`,
    };
  const numberOnly = baseName.match(
    /^(?:№\s*)?([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9./_-]*)/
  );
  return { contractNumber: numberOnly?.[1] ?? null, contractDate: null };
};
const buildOcrFallback = (fileName?: string, reason?: string) => {
  const identity = parseScanIdentity(fileName);
  return {
    contractNumber: identity.contractNumber,
    contractDate: identity.contractDate,
    tenantName: null,
    tenantContact: null,
    tenantEmail: null,
    propertyName: null,
    unitName: null,
    startDate: null,
    endDate: null,
    tariffType: null,
    tariffAmount: null,
    status: null,
    confidence: 0,
    fieldConfidence: {
      contractNumber: identity.contractNumber ? 0.9 : 0,
      contractDate: identity.contractDate ? 0.9 : 0,
    },
    warnings: [
      reason ??
        "OCR временно недоступен: сервис распознавания вернул ошибку 412/лимит использования.",
      "Номер и дата взяты из имени файла; заполните остальные поля вручную и проверьте реквизиты перед сохранением.",
    ],
  };
};
const parseOcrJson = (value: string) => {
  const cleaned = value
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate =
    start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "неизвестная ошибка";
    throw new Error(`OCR вернул повреждённый JSON (${message})`);
  }
};
const OCR_SYSTEM_PROMPT =
  "Ты аккуратно распознаёшь договор проживания (на русском, казахском или английском). Не угадывай данные: неизвестные поля возвращай null. Даты нормализуй в YYYY-MM-DD. Вид тарифа может быть только monthly или daily; месячный тариф означает ставку за месяц, суточный — ставку за сутки. Для каждого поля заполни fieldConfidence числом от 0 до 1: оценивай только качество распознавания этого поля, а для null ставь 0. Верни только JSON.";
const SCAN_KEYS = [
  "contractNumber",
  "contractDate",
  "tenantName",
  "tenantContact",
  "tenantEmail",
  "propertyName",
  "unitName",
  "startDate",
  "endDate",
  "tariffType",
  "tariffAmount",
  "status",
] as const;
/** Models sometimes omit keys, send numbers as strings or unknown enum values — normalise before strict validation. */
const withScanDefaults = (value: any) => {
  const raw = value && typeof value === "object" ? value : {};
  const out: any = { confidence: 0, fieldConfidence: {}, warnings: [], ...raw };
  for (const key of SCAN_KEYS)
    if (out[key] === undefined || out[key] === "") out[key] = null;
  if (typeof out.tariffAmount === "string") {
    const n = Number(
      out.tariffAmount.replace(/[^\d.,]/g, "").replace(",", ".")
    );
    out.tariffAmount = Number.isFinite(n) && n > 0 ? n : null;
  }
  if (!["monthly", "daily"].includes(out.tariffType)) out.tariffType = null;
  if (!["active", "paused", "ended"].includes(out.status)) out.status = null;
  for (const key of SCAN_KEYS)
    if (
      key !== "tariffAmount" &&
      out[key] !== null &&
      typeof out[key] !== "string"
    )
      out[key] = String(out[key]);
  out.confidence = Math.min(1, Math.max(0, Number(out.confidence) || 0));
  out.fieldConfidence = Object.fromEntries(
    Object.entries(out.fieldConfidence ?? {}).map(([k, v]) => [
      k,
      Math.min(1, Math.max(0, Number(v) || 0)),
    ])
  );
  out.warnings = Array.isArray(out.warnings) ? out.warnings.map(String) : [];
  return out;
};
async function extractContractFromScan(input: {
  dataUrl: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  fileName?: string;
}) {
  // Size, encoding and real file type are verified before any parser sees the bytes.
  const upload = decodeScanUpload(input.dataUrl, input.mimeType);
  const base64 = upload.buffer.toString("base64");
  const mimeType = upload.mimeType as typeof input.mimeType;
  const fileName = input.fileName
    ? cleanDisplayFileName(input.fileName)
    : undefined;
  const provider = getOcrProvider();
  if (provider) {
    try {
      const text = await provider.recognize({
        base64,
        mimeType,
        system: OCR_SYSTEM_PROMPT,
        prompt: OCR_FIELDS_PROMPT,
      });
      if (!text.trim())
        throw new Error("Сервис распознавания вернул пустой ответ");
      return scanResultValidator.parse(withScanDefaults(parseOcrJson(text)));
    } catch (error) {
      console.warn(`[OCR:${provider.name}]`, error);
      return buildOcrFallback(
        fileName,
        isOcrCapacityError(error)
          ? undefined
          : "Автораспознавание не сработало. Номер и дата взяты из имени файла."
      );
    }
  }
  if (
    // The legacy Manus Forge model is used only when explicitly requested (OCR_ENGINE=forge):
    // its variables may still be present after the move to Railway while the service no longer works.
    process.env.OCR_ENGINE !== "forge" ||
    !process.env.BUILT_IN_FORGE_API_URL ||
    !process.env.BUILT_IN_FORGE_API_KEY
  ) {
    // Default: our own recognition (MuPDF + Tesseract + contract rules), no external service involved.
    try {
      const {
        rawText: _raw,
        usedOcr,
        ...fields
      } = await recognizeLocally({ base64, mimeType });
      const merged = withScanDefaults(
        mergeWithFileName(fields, fileName, usedOcr)
      );
      return scanResultValidator.parse(merged);
    } catch (error) {
      console.warn("[OCR:local]", error);
      if (error instanceof Error && error.name === "OcrBusyError")
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: error.message,
        });
      return buildOcrFallback(
        fileName,
        "Распознавание не удалось. Номер и дата взяты из имени файла."
      );
    }
  }
  input = {
    ...input,
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
    fileName,
  };
  try {
    const models = await listLLMModels();
    const model =
      models.data.find(item => item.id === "gemini-3-flash-preview")?.id ??
      models.data.find(item => item.id.includes("gemini"))?.id;
    if (!model) throw new Error("OCR capacity unavailable");
    const fileContent =
      input.mimeType === "application/pdf"
        ? {
            type: "file_url" as const,
            file_url: { url: input.dataUrl, mime_type: input.mimeType },
          }
        : {
            type: "image_url" as const,
            image_url: { url: input.dataUrl, detail: "high" as const },
          };
    const response = await invokeLLM({
      model,
      messages: [
        {
          role: "system",
          content:
            "Ты аккуратно распознаёшь договор проживания. Не угадывай данные: неизвестные поля возвращай null. Даты нормализуй в YYYY-MM-DD. Вид тарифа может быть только monthly или daily; месячный тариф означает ставку за месяц, суточный — ставку за сутки. Для каждого поля заполни fieldConfidence с числом от 0 до 1: оценивай только качество распознавания этого поля, а для null ставь 0. Верни только JSON по схеме.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Извлеки реквизиты договора из приложенного скана.",
            },
            fileContent,
          ],
        },
      ],
      max_tokens: 3000,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "contract_scan",
          strict: true,
          schema: scanResultSchema,
        },
      },
    });
    const raw = response.choices[0]?.message?.content;
    const text = Array.isArray(raw)
      ? raw
          .filter((item: any) => item.type === "text")
          .map((item: any) => item.text)
          .join("")
      : raw;
    if (!text) throw new Error("Модель не вернула данные распознавания");
    try {
      return scanResultValidator.parse(parseOcrJson(text));
    } catch (error) {
      if (error instanceof Error && /повреждённый JSON/i.test(error.message))
        return buildOcrFallback(
          input.fileName,
          "OCR вернул повреждённый JSON; заполните поля вручную и проверьте их перед сохранением."
        );
      throw error;
    }
  } catch (error) {
    console.warn("[OCR:forge]", error);
    return buildOcrFallback(
      input.fileName,
      isOcrCapacityError(error)
        ? undefined
        : "Автораспознавание не сработало. Номер и дата взяты из имени файла."
    );
  }
}

export const appRouter = router({
  admin: router({
    users: adminProcedure.query(async () =>
      (await dbHelpers.listUsers()).map(user => ({
        ...user,
        hasPassword: Boolean(Number(user.hasPassword)),
        mustChangePassword: Boolean(user.mustChangePassword),
      }))
    ),
    securityAudit: adminProcedure.query(() =>
      dbHelpers.listSecurityAuditEvents()
    ),
    updateUser: adminProcedure
      .input(
        z.object({
          id: idSchema,
          role: z.enum(["admin", "manager"]).optional(),
          departmentId: idSchema.nullable().optional(),
          managedBlocks: z
            .array(z.string().trim().min(1).max(120))
            .max(20)
            .optional(),
          accountStatus: z.enum(["pending", "active", "disabled"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const target = await dbHelpers.getUserById(input.id);
        if (!target) throw new Error("Пользователь не найден");
        const role = input.role ?? target.role;
        const departmentId =
          input.departmentId === undefined
            ? target.departmentId
            : input.departmentId;
        const managedBlocks =
          input.managedBlocks === undefined
            ? target.managedBlocks
            : role === "admin"
              ? null
              : JSON.stringify(Array.from(new Set(input.managedBlocks)));
        const accountStatus = input.accountStatus ?? target.accountStatus;
        if (
          input.id === ctx.user.id &&
          (role !== target.role || accountStatus !== target.accountStatus)
        )
          throw new Error("Нельзя изменять собственную роль или статус");
        return dbHelpers.updateUserAccessWithAudit({
          actorUserId: ctx.user.id,
          targetUserId: input.id,
          role,
          departmentId: departmentId ?? null,
          managedBlocks,
          accountStatus,
        });
      }),
    // Adding an employee: the account is created active with a generated one-time password.
    // The password is returned to the administrator exactly once (only its scrypt hash is stored);
    // on first sign-in the employee is forced to replace it with their own password.
    createUser: adminProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(255),
          email: z.string().trim().max(320).email(),
          role: z.enum(["admin", "manager"]),
          departmentId: idSchema.nullable().optional(),
          managedBlocks: z
            .array(z.string().trim().min(1).max(120))
            .max(20)
            .default([]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const email = normalizeEmail(input.email);
        if (await dbHelpers.getUserByEmailNormalized(email))
          throw new Error("Пользователь с таким Email уже существует");
        const managedBlocks =
          input.role === "admin"
            ? null
            : JSON.stringify(Array.from(new Set(input.managedBlocks)));
        const temporaryPassword = generateTemporaryPassword();
        const temporaryPasswordExpiresAt = new Date(
          Date.now() + TEMPORARY_PASSWORD_TTL_MS
        );
        const user = await dbHelpers.createLocalUser({
          name: input.name,
          email: input.email.trim(),
          emailNormalized: email,
          passwordHash: await hashPassword(temporaryPassword),
          accountStatus: "active",
          role: input.role,
          departmentId: input.departmentId ?? null,
          managedBlocks,
          mustChangePassword: true,
          temporaryPasswordExpiresAt,
        });
        await dbHelpers.createSecurityAuditEvent({
          eventType: "user_created",
          actorUserId: ctx.user.id,
          targetUserId: user.id,
          oldValue: "none",
          newValue: JSON.stringify({
            role: input.role,
            departmentId: input.departmentId ?? null,
            managedBlocks: input.role === "admin" ? [] : input.managedBlocks,
            temporaryPassword: "issued",
          }),
        });
        return {
          user: sanitizeAuthUser(user),
          temporaryPassword,
          temporaryPasswordExpiresAt,
        };
      }),
    issueTemporaryPassword: adminProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        if (input.userId === ctx.user.id)
          throw new Error(
            "Для своей учётной записи используйте смену пароля в профиле"
          );
        const user = await dbHelpers.getUserById(input.userId);
        if (!user) throw new Error("Пользователь не найден");
        if (user.accountStatus === "disabled")
          throw new Error("Учётная запись отключена — сначала включите её");
        const temporaryPassword = generateTemporaryPassword();
        const temporaryPasswordExpiresAt = new Date(
          Date.now() + TEMPORARY_PASSWORD_TTL_MS
        );
        await dbHelpers.updateUserLocalAuth(user.id, {
          passwordHash: await hashPassword(temporaryPassword),
          passwordChangedAt: new Date(),
          mustChangePassword: true,
          temporaryPasswordExpiresAt,
          accountStatus: "active",
          loginMethod: "local",
        });
        await revokeAllUserSessions(user.id);
        await dbHelpers.createSecurityAuditEvent({
          eventType: "temporary_password_issued",
          actorUserId: ctx.user.id,
          targetUserId: user.id,
          oldValue: user.accountStatus,
          newValue: "active; must change password",
        });
        return {
          email: user.email,
          temporaryPassword,
          temporaryPasswordExpiresAt,
        };
      }),
    departments: protectedProcedure.query(() => dbHelpers.listDepartments()),
    createDepartment: adminProcedure
      .input(z.object({ name: z.string().trim().min(2).max(255) }))
      .mutation(({ input }) => dbHelpers.createDepartment(input.name)),
    documentPermissions: adminProcedure
      .input(z.object({ documentId: idSchema.optional() }).optional())
      .query(({ input }) =>
        dbHelpers.listDocumentPermissions(input?.documentId)
      ),
    setDocumentPermission: adminProcedure
      .input(
        z.object({
          documentId: idSchema,
          userId: idSchema.nullable().optional(),
          departmentId: idSchema.nullable().optional(),
          canView: z.enum(["yes", "no"]),
        })
      )
      .mutation(async ({ input }) => {
        if (!(await getDocument(input.documentId)))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Документ не найден",
          });
        if (input.userId == null && input.departmentId == null)
          throw new Error("Укажите пользователя или подразделение");
        return dbHelpers.upsertDocumentPermission({
          documentId: input.documentId,
          userId: input.userId ?? null,
          departmentId: input.departmentId ?? null,
          canView: input.canView,
        });
      }),
    revokeDocumentPermission: adminProcedure
      .input(z.object({ id: idSchema }))
      .mutation(({ input }) => dbHelpers.deleteDocumentPermission(input.id)),
  }),
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts =>
      opts.ctx.user ? sanitizeAuthUser(opts.ctx.user) : null
    ),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().trim().max(320).email(),
          password: z.string().min(1).max(LIMITS.passwordMax),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const emailNormalized = normalizeEmail(input.email);
        const ip = requestIp(ctx.req);
        // Throttling is counted per account+IP, per account (credential stuffing from many IPs)
        // and per IP (password spraying); counters live in the database (shared by all instances).
        const tooMany =
          "Слишком много попыток входа. Подождите 15 минут и попробуйте снова.";
        // Per account+IP every attempt counts (atomic, also stops parallel bursts). Per account and
        // per IP only FAILED attempts count, so normal sign-ins never consume those budgets.
        const ipKey = rateKey("ip", ip);
        const accountKey = rateKey("email", emailNormalized);
        for (const [rule, key] of [
          [RULES.loginPerIp, ipKey],
          [RULES.loginPerAccount, accountKey],
        ] as const)
          if (!(await peekRateLimit(rule, key)).allowed)
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: tooMany,
            });
        await enforce(
          RULES.loginPerAccountAndIp,
          rateKey("ip-email", ip, emailNormalized),
          tooMany
        );
        const user = await dbHelpers.getUserByEmailNormalized(emailNormalized);
        // The password is always hashed, even for unknown accounts: equal timing, no user enumeration.
        const passwordOk = await verifyPassword(
          input.password,
          user?.passwordHash ?? DUMMY_PASSWORD_HASH
        );
        if (!user || !passwordOk || user.accountStatus !== "active") {
          await consume(RULES.loginPerIp, ipKey);
          await consume(RULES.loginPerAccount, accountKey);
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Неверный Email или пароль",
          });
        }
        if (
          user.mustChangePassword &&
          user.temporaryPasswordExpiresAt &&
          user.temporaryPasswordExpiresAt.getTime() <= Date.now()
        )
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message:
              "Срок действия временного пароля истёк. Попросите администратора выдать новый.",
          });
        await resetRateLimit(
          RULES.loginPerAccountAndIp,
          rateKey("ip-email", ip, emailNormalized)
        );
        // Session fixation: a session presented before login is revoked; a fresh token is issued.
        await revokeCurrentSession(ctx.req);
        const session = await establishSession(ctx.req, ctx.res, user.id);
        ctx.res.cookie(COOKIE_NAME, session.token, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: session.maxAge,
        });
        await dbHelpers.updateUserLocalAuth(user.id, {
          lastSignedIn: new Date(),
          loginMethod: "local",
        });
        return sanitizeAuthUser(user);
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await revokeCurrentSession(ctx.req);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    changePassword: protectedProcedure
      .input(
        z.object({
          currentPassword: z.string().min(1).max(LIMITS.passwordMax),
          newPassword: z.string().min(10).max(LIMITS.passwordMax),
          confirmPassword: z.string().min(10).max(LIMITS.passwordMax),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await enforce(
          RULES.passwordChange,
          rateKey("user", ctx.user.id),
          "Слишком много попыток смены пароля. Подождите 15 минут."
        );
        if (input.newPassword !== input.confirmPassword)
          throw new Error("Пароли не совпадают");
        if (
          !(await verifyPassword(input.currentPassword, ctx.user.passwordHash))
        )
          throw new Error("Неверный текущий пароль");
        if (input.newPassword === input.currentPassword)
          throw new Error("Новый пароль должен отличаться от текущего");
        const passwordHash = await hashPassword(input.newPassword);
        await dbHelpers.updateUserLocalAuth(ctx.user.id, {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          temporaryPasswordExpiresAt: null,
        });
        await revokeAllUserSessions(ctx.user.id);
        const session = await establishSession(ctx.req, ctx.res, ctx.user.id);
        ctx.res.cookie(COOKIE_NAME, session.token, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: session.maxAge,
        });
        return { success: true } as const;
      }),
  }),
  contractFolders: router({
    list: protectedProcedure.query(() => listContractFolders()),
    create: protectedProcedure
      .input(z.object({ name: z.string().trim().min(1).max(120) }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageFolders",
          "Недостаточно прав для управления папками"
        );
        return createContractFolder(input.name);
      }),
    rename: protectedProcedure
      .input(
        z.object({
          id: idSchema,
          oldName: z.string().min(1),
          name: z.string().trim().min(1).max(120),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageFolders",
          "Недостаточно прав для управления папками"
        );
        return renameContractFolder(input.id, input.name, input.oldName);
      }),
    remove: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageFolders",
          "Недостаточно прав для управления папками"
        );
        return deleteContractFolder(input.id);
      }),
  }),
  contracts: router({
    list: protectedProcedure
      .input(z.object({ includeArchived: z.boolean().optional() }).optional())
      .query(async ({ input, ctx }) => {
        const rows = await listContracts(Boolean(input?.includeArchived));
        return ctx.user.role === "admin"
          ? rows
          : rows.filter(row => canManageContract(ctx.user, row));
      }),
    audit: protectedProcedure
      .input(z.object({ contractId: idSchema }))
      .query(async ({ input, ctx }) => {
        const contract = await requireContractById(ctx.user, input.contractId);
        return dbHelpers.listContractAudit(contract.id);
      }),
    logView: protectedProcedure
      .input(z.object({ contractId: idSchema }))
      .mutation(async ({ input, ctx }) => {
        const contract = await requireContractById(ctx.user, input.contractId);
        await recordContractAudit({
          contractId: contract.id,
          actorUserId: ctx.user.id,
          action: "viewed",
          details: "Просмотр карточки договора",
        });
        return { success: true };
      }),
    create: protectedProcedure
      .input(contractInput)
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageContracts",
          "Недостаточно прав для создания договора"
        );
        await ensureUniqueContractNumber(input.contractNumber);
        const blockFolder = deriveBlockFolder(
          input.propertyName,
          input.unitName,
          input.blockFolder
        );
        requireBlockAccess(ctx.user, blockFolder);
        const contract = await createContract({
          ...input,
          contractDate: input.contractDate
            ? new Date(`${input.contractDate}T00:00:00Z`)
            : null,
          startDate: new Date(`${input.startDate}T00:00:00Z`),
          endDate: new Date(`${input.endDate}T00:00:00Z`),
          terminationDate: input.terminationDate
            ? new Date(`${input.terminationDate}T00:00:00Z`)
            : null,
          terminationReason: input.terminationReason?.trim() || null,
          tariffAmount: input.tariffAmount.toFixed(2),
          tenantContact: input.tenantContact ?? null,
          blockFolder,
          tenantEmail: input.tenantEmail?.trim() || null,
          unitName: input.unitName ?? null,
          notes: input.notes ?? null,
          departmentId: ctx.user.departmentId ?? null,
        });
        if (contract)
          await recordContractAudit({
            contractId: contract.id,
            actorUserId: ctx.user.id,
            action: "created",
            details: "Создание договора",
          });
        return contract;
      }),
    delete: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageContracts",
          "Недостаточно прав для архивирования договора"
        );
        const contract = await requireContractById(ctx.user, input.id);
        const result = await dbHelpers.archiveContract(input.id);
        await recordContractAudit({
          contractId: input.id,
          actorUserId: ctx.user.id,
          action: "updated",
          details: "Договор перемещён в архив",
        });
        return result;
      }),
    restore: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageContracts",
          "Недостаточно прав для восстановления договора"
        );
        const contract = await requireContractById(ctx.user, input.id);
        const result = await dbHelpers.restoreContract(input.id);
        await recordContractAudit({
          contractId: input.id,
          actorUserId: ctx.user.id,
          action: "updated",
          details: "Договор восстановлен из архива",
        });
        return result;
      }),
    permanentDeleteEligible: adminProcedure.query(() =>
      listPermanentlyDeletableContractIds()
    ),
    permanentlyDelete: adminProcedure
      .input(
        z.object({
          id: idSchema,
          confirmation: z.literal("УДАЛИТЬ"),
        })
      )
      .mutation(async ({ input }) => permanentlyDeleteContract(input.id)),
    permanentlyDeleteMany: adminProcedure
      .input(
        z.object({
          ids: z.array(idSchema).min(1).max(LIMITS.bulkIds),
          confirmation: z.literal("УДАЛИТЬ"),
        })
      )
      .mutation(async ({ input }) => permanentlyDeleteContracts(input.ids)),
    update: protectedProcedure
      .input(contractInput.safeExtend({ id: idSchema }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const existing = await requireContractById(ctx.user, id);
        assertPermission(
          ctx.user.role,
          "manageContracts",
          "Недостаточно прав для изменения договора"
        );
        await ensureUniqueContractNumber(data.contractNumber, id);
        const blockFolder = deriveBlockFolder(
          data.propertyName,
          data.unitName,
          data.blockFolder
        );
        requireBlockAccess(ctx.user, blockFolder);
        const contract = await updateContract(id, {
          ...data,
          contractDate: data.contractDate
            ? new Date(`${data.contractDate}T00:00:00Z`)
            : null,
          startDate: new Date(`${data.startDate}T00:00:00Z`),
          endDate: new Date(`${data.endDate}T00:00:00Z`),
          terminationDate: data.terminationDate
            ? new Date(`${data.terminationDate}T00:00:00Z`)
            : null,
          terminationReason: data.terminationReason?.trim() || null,
          tariffAmount: data.tariffAmount.toFixed(2),
          tenantContact: data.tenantContact ?? null,
          blockFolder,
          tenantEmail: data.tenantEmail?.trim() || null,
          unitName: data.unitName ?? null,
          notes: data.notes ?? null,
          departmentId: existing?.departmentId ?? ctx.user.departmentId,
          ...(shouldReopenContract(data) ? { archivedAt: null } : {}),
        });
        if (contract) {
          await recalculateDraftAccrualsForContract(contract);
          await recordContractAudit({
            contractId: contract.id,
            actorUserId: ctx.user.id,
            action: "updated",
            details: "Изменение договора",
          });
        }
        return contract;
      }),
    previewScan: protectedProcedure
      .input(
        z.object({
          dataUrl: dataUrlSchema(LIMITS.scanBytes),
          fileName: fileNameSchema.optional(),
          mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageContracts",
          "Недостаточно прав для распознавания договоров"
        );
        await enforce(RULES.scanRecognition, rateKey("user", ctx.user.id));
        return extractContractFromScan(input);
      }),
    createFromScan: protectedProcedure
      .input(
        z.object({
          fileName: fileNameSchema,
          mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
          dataUrl: dataUrlSchema(LIMITS.scanBytes),
          fields: contractInput,
          duplicateMode: z.enum(["new", "overwrite", "merge"]).default("new"),
          duplicateContractId: idSchema.optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageContracts",
          "Недостаточно прав для создания договора"
        );
        await enforce(RULES.fileUpload, rateKey("user", ctx.user.id));
        // Validated once, before anything is written: real type from magic bytes, bounded size.
        const upload = decodeScanUpload(input.dataUrl, input.mimeType);
        const displayName = cleanDisplayFileName(input.fileName);
        const target = input.duplicateContractId
          ? await getContract(input.duplicateContractId)
          : null;
        if (
          (input.duplicateMode === "overwrite" ||
            input.duplicateMode === "merge") &&
          !target
        )
          throw new Error("Договор для операции с дубликатом не найден");
        if (target) requireContractAccess(ctx.user, target);
        const fields =
          input.duplicateMode === "merge" && target
            ? {
                contractNumber:
                  input.fields.contractNumber ||
                  target.contractNumber ||
                  undefined,
                contractDate:
                  input.fields.contractDate ||
                  (target.contractDate
                    ? toDateOnly(target.contractDate)
                    : undefined),
                tenantName: input.fields.tenantName || target.tenantName,
                tenantContact:
                  input.fields.tenantContact ||
                  target.tenantContact ||
                  undefined,
                tenantEmail:
                  input.fields.tenantEmail || target.tenantEmail || undefined,
                tenantCategory:
                  input.fields.tenantCategory ||
                  target.tenantCategory ||
                  undefined,
                tenantNumber:
                  input.fields.tenantNumber || target.tenantNumber || undefined,
                propertyName: input.fields.propertyName || target.propertyName,
                unitName: input.fields.unitName || target.unitName || undefined,
                startDate:
                  input.fields.startDate || toDateOnly(target.startDate),
                endDate: input.fields.endDate || toDateOnly(target.endDate),
                terminationDate:
                  input.fields.terminationDate ||
                  (target.terminationDate
                    ? toDateOnly(target.terminationDate)
                    : undefined),
                terminationReason:
                  input.fields.terminationReason ||
                  target.terminationReason ||
                  undefined,
                tariffType: input.fields.tariffType || target.tariffType,
                tariffAmount:
                  input.fields.tariffAmount || Number(target.tariffAmount),
                status: input.fields.status || target.status,
                notes: input.fields.notes || target.notes || undefined,
              }
            : input.fields;
        if (
          input.duplicateMode === "overwrite" ||
          input.duplicateMode === "merge"
        ) {
          if (!target)
            throw new Error("Договор для операции с дубликатом не найден");
          await ensureUniqueContractNumber(fields.contractNumber, target.id);
          const blockFolder = deriveBlockFolder(
            String(fields.propertyName),
            fields.unitName,
            "blockFolder" in fields ? fields.blockFolder : target.blockFolder
          );
          requireBlockAccess(ctx.user, blockFolder);
          const updated = await updateContract(target.id, {
            ...fields,
            contractDate: fields.contractDate
              ? new Date(String(fields.contractDate) + "T00:00:00Z")
              : null,
            startDate: new Date(String(fields.startDate) + "T00:00:00Z"),
            endDate: new Date(String(fields.endDate) + "T00:00:00Z"),
            terminationDate: fields.terminationDate
              ? new Date(String(fields.terminationDate) + "T00:00:00Z")
              : null,
            terminationReason: fields.terminationReason?.trim() || null,
            tariffAmount: Number(fields.tariffAmount).toFixed(2),
            tenantContact: fields.tenantContact ?? null,
            tenantEmail: fields.tenantEmail?.trim() || null,
            tenantCategory: fields.tenantCategory?.trim() || null,
            tenantNumber: fields.tenantNumber?.trim() || null,
            unitName: fields.unitName ?? null,
            blockFolder,
            notes: fields.notes ?? null,
            departmentId: target.departmentId,
            ...(shouldReopenContract(fields) ? { archivedAt: null } : {}),
          });
          if (!updated) throw new Error("Не удалось обновить договор");
          await recalculateDraftAccrualsForContract(updated);
          const safeName = storageSafeName(displayName);
          const encrypted = encryptContractFile(upload.buffer);
          const { key, url } = await storagePut(
            String(ctx.user.id) +
              "/contracts/scans/" +
              Date.now() +
              "-" +
              safeName +
              ".enc",
            encrypted.data,
            "application/octet-stream"
          );
          await createDocument({
            contractId: updated.id,
            fileName: displayName,
            mimeType: upload.mimeType as "application/pdf",
            fileKey: key,
            fileUrl: url,
            encryptionVersion: encrypted.version,
            encryptionIv: encrypted.iv,
            encryptionAuthTag: encrypted.authTag,
          });
          await recordContractAudit({
            contractId: updated.id,
            actorUserId: ctx.user.id,
            action: input.duplicateMode === "merge" ? "updated" : "updated",
            details:
              input.duplicateMode === "merge"
                ? "Объединение данных из скана"
                : "Перезапись договора из скана",
          });
          return updated;
        }
        await ensureUniqueContractNumber(input.fields.contractNumber);
        const blockFolder = deriveBlockFolder(
          input.fields.propertyName,
          input.fields.unitName,
          input.fields.blockFolder
        );
        requireBlockAccess(ctx.user, blockFolder);
        const safeName = storageSafeName(displayName);
        const encrypted = encryptContractFile(upload.buffer);
        const { key, url } = await storagePut(
          String(ctx.user.id) +
            "/contracts/scans/" +
            Date.now() +
            "-" +
            safeName +
            ".enc",
          encrypted.data,
          "application/octet-stream"
        );
        const contract = await createContract({
          ...input.fields,
          contractDate: input.fields.contractDate
            ? new Date(String(input.fields.contractDate) + "T00:00:00Z")
            : null,
          startDate: new Date(String(input.fields.startDate) + "T00:00:00Z"),
          endDate: new Date(String(input.fields.endDate) + "T00:00:00Z"),
          terminationDate: input.fields.terminationDate
            ? new Date(String(input.fields.terminationDate) + "T00:00:00Z")
            : null,
          terminationReason: input.fields.terminationReason?.trim() || null,
          tariffAmount: input.fields.tariffAmount.toFixed(2),
          tenantContact: input.fields.tenantContact ?? null,
          tenantEmail: input.fields.tenantEmail?.trim() || null,
          tenantCategory: input.fields.tenantCategory?.trim() || null,
          tenantNumber: input.fields.tenantNumber?.trim() || null,
          unitName: input.fields.unitName ?? null,
          notes: input.fields.notes ?? null,
          blockFolder,
          departmentId: ctx.user.departmentId ?? null,
        });
        if (!contract)
          throw new Error("Не удалось сохранить договор после загрузки скана");
        await createDocument({
          contractId: contract.id,
          fileName: displayName,
          mimeType: upload.mimeType as "application/pdf",
          fileKey: key,
          fileUrl: url,
          encryptionVersion: encrypted.version,
          encryptionIv: encrypted.iv,
          encryptionAuthTag: encrypted.authTag,
        });
        await recordContractAudit({
          contractId: contract.id,
          actorUserId: ctx.user.id,
          action: "created",
          details: "Создание договора из скана",
        });
        return contract;
      }),
    previewImport: protectedProcedure
      .input(
        z.object({
          dataUrl: dataUrlSchema(LIMITS.spreadsheetBytes),
          // Only known columns, only sane indexes (no arbitrary keys → no prototype pollution).
          mapping: z
            .object(
              Object.fromEntries(
                IMPORT_COLUMNS.map(key => [
                  key,
                  z
                    .number()
                    .int()
                    .min(0)
                    .max(LIMITS.spreadsheetColumns)
                    .optional(),
                ])
              ) as Record<
                (typeof IMPORT_COLUMNS)[number],
                z.ZodOptional<z.ZodNumber>
              >
            )
            .strict()
            .optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageContracts",
          "Недостаточно прав для импорта договоров"
        );
        await enforce(RULES.spreadsheetParse, rateKey("user", ctx.user.id));
        const upload = decodeSpreadsheetUpload(input.dataUrl);
        return parseContractsExcel(upload.buffer, input.mapping as any);
      }),
    moveToFolder: protectedProcedure
      .input(
        z.object({
          ids: z.array(idSchema).min(1).max(LIMITS.bulkIds),
          folderName: z.string().trim().min(1).max(120),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageFolders",
          "Недостаточно прав для переноса договоров"
        );
        if (ctx.user.role !== "admin") {
          const targets = await Promise.all(
            input.ids.map(id => getContract(id))
          );
          for (const target of targets) {
            if (!target) throw new Error("Договор не найден");
            requireContractAccess(ctx.user, target);
          }
          requireBlockAccess(ctx.user, input.folderName);
        }
        const result = await moveContractsToFolder(input.ids, input.folderName);
        for (const id of input.ids)
          await recordContractAudit({
            contractId: id,
            actorUserId: ctx.user.id,
            action: "updated",
            details: "Договор перемещён в папку «" + input.folderName + "»",
          });
        return result;
      }),
    importRows: protectedProcedure
      .input(
        z.object({ rows: z.array(contractInput).min(1).max(LIMITS.importRows) })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageContracts",
          "Недостаточно прав для импорта договоров"
        );
        // Validate the entire chunk before the first INSERT. Otherwise one bad row
        // near the end of a 100-row batch leaves earlier rows saved while the UI
        // reports the whole chunk as failed.
        const prepared = input.rows.map(row => ({
          row,
          blockFolder: deriveBlockFolder(
            row.propertyName,
            row.unitName,
            row.blockFolder
          ),
        }));
        const seenNumbers = new Set<string>();
        for (const { row, blockFolder } of prepared) {
          requireBlockAccess(ctx.user, blockFolder);
          const normalizedNumber = row.contractNumber?.trim().toLocaleLowerCase();
          if (normalizedNumber) {
            if (seenNumbers.has(normalizedNumber))
              throw new Error(
                `В импортируемом файле повторяется номер договора «${row.contractNumber!.trim()}»`
              );
            seenNumbers.add(normalizedNumber);
            await ensureUniqueContractNumber(row.contractNumber);
          }
        }
        const imported = [];
        for (const { row, blockFolder } of prepared) {
          imported.push(
            await createContract({
              ...row,
              contractDate: row.contractDate
                ? new Date(`${row.contractDate}T00:00:00Z`)
                : null,
              startDate: new Date(`${row.startDate}T00:00:00Z`),
              endDate: new Date(`${row.endDate}T00:00:00Z`),
              terminationDate: row.terminationDate
                ? new Date(`${row.terminationDate}T00:00:00Z`)
                : null,
              terminationReason: row.terminationReason?.trim() || null,
              tariffAmount: row.tariffAmount.toFixed(2),
              tenantContact: row.tenantContact ?? null,
              blockFolder,
              tenantEmail: row.tenantEmail?.trim() || null,
              tenantCategory: row.tenantCategory?.trim() || null,
              tenantNumber: row.tenantNumber?.trim() || null,
              unitName: row.unitName ?? null,
              notes: row.notes ?? null,
              departmentId: ctx.user.departmentId ?? null,
            })
          );
        }
        for (const contract of imported)
          if (contract)
            await recordContractAudit({
              contractId: contract.id,
              actorUserId: ctx.user.id,
              action: "created",
              details: "Импорт договора из Excel",
            });
        return imported;
      }),
  }),
  documents: router({
    list: protectedProcedure
      .input(z.object({ contractId: idSchema.optional() }).optional())
      .query(async ({ input, ctx }) => {
        const docs = await listDocuments(input?.contractId);
        const sanitize = (doc: (typeof docs)[number]) => {
          const { fileKey: _fileKey, fileUrl: _fileUrl, ...safe } = doc;
          return safe;
        };
        if (ctx.user.role === "admin") return docs.map(sanitize);
        const contracts = await listContracts(true);
        const contractById = new Map(
          contracts.map(contract => [contract.id, contract])
        );
        const visible = [];
        for (const doc of docs) {
          const contract = contractById.get(doc.contractId);
          const permissions = await dbHelpers.listDocumentPermissions(doc.id);
          const allowed = canViewDocument(ctx.user, contract, permissions);
          if (allowed) visible.push(sanitize(doc));
        }
        return visible;
      }),
    download: protectedProcedure
      .input(z.object({ documentId: idSchema }))
      .query(async ({ input, ctx }) => {
        const { document } = await requireDocumentAccess(
          ctx.user,
          input.documentId,
          "view"
        );
        const stored = await storageRead(document.fileKey);
        const data =
          document.encryptionVersion > 0 &&
          document.encryptionIv &&
          document.encryptionAuthTag
            ? decryptContractFile(stored, {
                version: document.encryptionVersion,
                iv: document.encryptionIv,
                authTag: document.encryptionAuthTag,
              })
            : stored;
        // Only the three scan types are ever returned as such; anything else is an opaque download
        // (a stored file can never be opened as HTML/SVG in the app's origin).
        const mimeType = (
          [MIME_BY_KIND.pdf, MIME_BY_KIND.jpeg, MIME_BY_KIND.png] as string[]
        ).includes(document.mimeType)
          ? document.mimeType
          : "application/octet-stream";
        return {
          fileName: document.fileName,
          mimeType,
          dataBase64: data.toString("base64"),
        };
      }),
    upload: protectedProcedure
      .input(
        z.object({
          contractId: idSchema,
          fileName: fileNameSchema,
          mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
          dataUrl: dataUrlSchema(LIMITS.scanBytes),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageContracts",
          "Недостаточно прав для загрузки документа"
        );
        const contract = await requireContractById(ctx.user, input.contractId);
        await enforce(RULES.fileUpload, rateKey("user", ctx.user.id));
        const upload = decodeScanUpload(input.dataUrl, input.mimeType);
        const displayName = cleanDisplayFileName(input.fileName);
        const encrypted = encryptContractFile(upload.buffer);
        const { key, url } = await storagePut(
          `${ctx.user.id}/contracts/${contract.id}/${Date.now()}-${storageSafeName(displayName)}.enc`,
          encrypted.data,
          "application/octet-stream"
        );
        return createDocument({
          contractId: contract.id,
          fileName: displayName,
          mimeType: upload.mimeType as "application/pdf",
          fileKey: key,
          fileUrl: url,
          encryptionVersion: encrypted.version,
          encryptionIv: encrypted.iv,
          encryptionAuthTag: encrypted.authTag,
        });
      }),
    delete: protectedProcedure
      .input(z.object({ documentId: idSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageContracts",
          "Недостаточно прав для удаления скана"
        );
        const { document } = await requireDocumentAccess(
          ctx.user,
          input.documentId,
          "manage"
        );
        const deleted = await deleteDocument(document.id);
        await recordContractAudit({
          contractId: document.contractId,
          actorUserId: ctx.user.id,
          action: "updated",
          details: `Удалён отдельный скан «${document.fileName}» без удаления договора`,
        });
        return {
          success: true,
          documentId: deleted.id,
          contractId: document.contractId,
        };
      }),
  }),
  accruals: router({
    list: protectedProcedure
      .input(z.object({ period: periodSchema }))
      .query(async ({ input, ctx }) =>
        scopeAccrualRows(ctx.user, await listAccruals(input.period))
      ),
    generate: protectedProcedure
      .input(
        z.object({
          period: periodSchema,
          blockFolder: z.string().trim().max(120).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageAccruals",
          "Недостаточно прав для генерации начислений"
        );
        const all = (await listContracts(true)).filter(contract =>
          canManageContract(ctx.user, contract)
        );
        const existing = await scopeAccrualRows(
          ctx.user,
          await listAccruals(input.period)
        );
        const created = [];
        for (const contract of all) {
          if (contract.status === "paused") continue;
          if (
            input.blockFolder &&
            deriveBlockFolder(
              contract.propertyName,
              contract.unitName,
              contract.blockFolder
            ) !== input.blockFolder
          )
            continue;
          const result = calculateAccrual(
            {
              startDate: toDateOnly(contract.startDate),
              endDate: toDateOnly(contract.endDate),
              terminationDate: contract.terminationDate
                ? toDateOnly(contract.terminationDate)
                : null,
              tariffType: contract.tariffType,
              tariffAmount: Number(contract.tariffAmount),
            },
            input.period
          );
          const previous = existing.find(row => row.contractId === contract.id);
          if (!result) continue;
          const values = {
            serviceFrom: new Date(`${result.serviceFrom}T00:00:00Z`),
            serviceTo: new Date(`${result.serviceTo}T00:00:00Z`),
            quantity: result.quantity.toFixed(2),
            amount: result.amount.toFixed(2),
            tenantName: contract.tenantName,
            tenantEmail: contract.tenantEmail ?? null,
            tenantCategory: contract.tenantCategory ?? null,
            tenantNumber: contract.tenantNumber ?? null,
            propertyName: contract.propertyName,
            unitName: contract.unitName ?? null,
            tariffType: contract.tariffType,
            tariffAmount: String(contract.tariffAmount),
          };
          if (previous?.status === "invoiced") continue;
          try {
            if (previous)
              created.push(await updateDraftAccrual(previous.id, values));
            else
              created.push(
                await createAccrual({
                  contractId: contract.id,
                  period: input.period,
                  ...values,
                  status: "draft",
                })
              );
          } catch (error) {
            // Invoiced meanwhile, or created by a concurrent run (unique contract+period): skip.
            if (isRaceSkip(error)) continue;
            throw error;
          }
        }
        return created;
      }),
    createStandalone: protectedProcedure
      .input(standaloneAccrualInput)
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageAccruals",
          "Недостаточно прав для создания начисления"
        );
        // A manager may create accruals only for the blocks assigned to them.
        requireBlockAccess(
          ctx.user,
          deriveBlockFolder(input.propertyName, input.unitName, null)
        );
        return createAccrual(standaloneValues(input));
      }),
    importStandalone: protectedProcedure
      .input(
        z.object({
          rows: z.array(standaloneAccrualInput).min(1).max(LIMITS.importRows),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageAccruals",
          "Недостаточно прав для импорта начислений"
        );
        // All rows are checked before anything is written (no partial import into foreign blocks).
        for (const row of input.rows)
          requireBlockAccess(
            ctx.user,
            deriveBlockFolder(row.propertyName, row.unitName, null)
          );
        const imported = [];
        for (const row of input.rows)
          imported.push(await createAccrual(standaloneValues(row)));
        return imported;
      }),
    /** Reads an uploaded .xlsx on the server (size/row limited) and returns its table. */
    readImportFile: protectedProcedure
      .input(z.object({ dataUrl: dataUrlSchema(LIMITS.spreadsheetBytes) }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageAccruals",
          "Недостаточно прав для импорта начислений"
        );
        await enforce(RULES.spreadsheetParse, rateKey("user", ctx.user.id));
        const upload = decodeSpreadsheetUpload(input.dataUrl);
        const [header = [], ...rows] = await readFirstSheetMatrix(
          upload.buffer
        );
        const headers = header.map(
          (cell, index) => String(cell ?? "").trim() || `__EMPTY_${index}`
        );
        return {
          headers,
          rows: rows.filter(cells =>
            cells.some(cell => String(cell ?? "").trim())
          ),
        };
      }),
    updateFromPreview: protectedProcedure
      .input(
        z.object({
          id: idSchema,
          contractId: idSchema.nullable().optional(),
          tenantName: z.string().trim().max(255).optional(),
          tenantEmail: optionalEmail.nullable().optional(),
          serviceFrom: isoDate.optional(),
          serviceTo: isoDate.optional(),
          amount: money.optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageAccruals",
          "Недостаточно прав для изменения начислений"
        );
        const { accrual: target } = await requireAccrualAccess(
          ctx.user,
          input.id
        );
        if (target.status === "invoiced")
          throw new Error("Начисление в счёте нельзя изменять");
        // Re-linking to another contract requires access to that contract too, and the contract
        // must not already have an accrual for this period (no double billing).
        if (
          input.contractId != null &&
          input.contractId !== target.contractId
        ) {
          await requireContractById(ctx.user, input.contractId);
          const clash = (await listAccruals(target.period)).find(
            row => row.contractId === input.contractId && row.id !== target.id
          );
          if (clash)
            throw new TRPCError({
              code: "CONFLICT",
              message: "У этого договора уже есть начисление за этот период",
            });
        }
        // Unlinking: the row then belongs to the block of its own address — it must stay accessible.
        if (input.contractId === null && target.contractId != null)
          requireBlockAccess(
            ctx.user,
            deriveBlockFolder(target.propertyName, target.unitName, null)
          );
        const serviceFrom = input.serviceFrom ?? toDateOnly(target.serviceFrom);
        const serviceTo = input.serviceTo ?? toDateOnly(target.serviceTo);
        if (serviceFrom > serviceTo)
          throw new Error("Дата начала не может быть позже даты окончания");
        const patch = {
          ...(input.contractId !== undefined
            ? { contractId: input.contractId }
            : {}),
          ...(input.tenantName !== undefined
            ? { tenantName: input.tenantName.trim() || null }
            : {}),
          ...(input.tenantEmail !== undefined
            ? { tenantEmail: input.tenantEmail?.trim() || null }
            : {}),
          ...(input.serviceFrom
            ? { serviceFrom: new Date(input.serviceFrom + "T00:00:00Z") }
            : {}),
          ...(input.serviceTo
            ? { serviceTo: new Date(input.serviceTo + "T00:00:00Z") }
            : {}),
          ...(input.amount !== undefined
            ? { amount: input.amount.toFixed(2), amountEdited: true }
            : {}),
        };
        return updateDraftAccrual(target.id, patch);
      }),
    updateAmount: protectedProcedure
      .input(z.object({ id: idSchema, amount: money }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageAccruals",
          "Недостаточно прав для изменения начислений"
        );
        const { accrual: target } = await requireAccrualAccess(
          ctx.user,
          input.id
        );
        if (target.status === "invoiced")
          throw new Error("Начисление в счёте нельзя изменять");
        return updateDraftAccrual(target.id, {
          amount: input.amount.toFixed(2),
          amountEdited: true,
        });
      }),
    updateEmail: protectedProcedure
      .input(z.object({ id: idSchema, tenantEmail: optionalEmail }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageAccruals",
          "Недостаточно прав для изменения начислений"
        );
        const { accrual: target } = await requireAccrualAccess(
          ctx.user,
          input.id
        );
        if (target.status === "invoiced")
          throw new Error("Начисление в счёте нельзя изменять");
        return updateDraftAccrual(target.id, {
          tenantEmail: input.tenantEmail?.trim() || null,
        });
      }),
    remove: protectedProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageAccruals",
          "Недостаточно прав для удаления начислений"
        );
        const { accrual: target } = await requireAccrualAccess(
          ctx.user,
          input.id
        );
        assertCanDeleteAccrual(ctx.user, target);
        return deleteAccrual(target.id);
      }),
    removeMany: protectedProcedure
      .input(z.object({ ids: z.array(idSchema).min(1).max(200) }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageAccruals",
          "Недостаточно прав для удаления начислений"
        );
        const ids = Array.from(new Set(input.ids));
        // Every row is authorised before the first one is deleted.
        const targets = [];
        for (const id of ids) {
          const { accrual } = await requireAccrualAccess(ctx.user, id);
          assertCanDeleteAccrual(ctx.user, accrual);
          targets.push(accrual);
        }
        for (const target of targets) await deleteAccrual(target.id);
        return { deleted: targets.length };
      }),
    clearHistory: adminProcedure
      .input(
        z.object({
          period: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
        })
      )
      .mutation(({ input }) => dbHelpers.clearDraftAccruals(input.period)),
  }),
  invoices: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await filterInvoices(ctx.user, await listInvoices());
      const scope = await loadScope(ctx.user);
      const accrualCache = new Map<
        string,
        Awaited<ReturnType<typeof listAccruals>>
      >();
      const enriched = [];
      for (const invoice of rows) {
        let accrualRows = accrualCache.get(invoice.period);
        if (!accrualRows) {
          accrualRows = await listAccruals(invoice.period);
          accrualCache.set(invoice.period, accrualRows);
        }
        const items = await getInvoiceItems(invoice.id);
        const contract = items
          .map(item =>
            scope.contractById.get(
              accrualRows?.find(row => row.id === item.accrualId)?.contractId ??
                -1
            )
          )
          .find(Boolean);
        enriched.push({
          ...invoice,
          contractNumber: contract?.contractNumber ?? null,
          contractDate: contract?.contractDate ?? null,
        });
      }
      return enriched;
    }),
    bulkCreate: protectedProcedure
      .input(z.object({ period: periodSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageInvoices",
          "Недостаточно прав для формирования счетов"
        );
        const scope = await loadScope(ctx.user);
        // Only accruals of the caller's blocks are billed.
        const accrualRows = (await listAccruals(input.period)).filter(row =>
          scope.canAccrual(row)
        );
        const draftRows = accrualRows.filter(row => row.status === "draft");
        if (!draftRows.length)
          return { created: [], skipped: accrualRows.length };
        const groups = new Map<string, typeof draftRows>();
        for (const row of draftRows) {
          const contract = scope.contractOf(row);
          const tenant = contract?.tenantName?.trim() || row.tenantName?.trim();
          if (!tenant) continue;
          const group = groups.get(tenant) ?? [];
          group.push(row);
          groups.set(tenant, group);
        }
        const created = [];
        for (const [tenantName, rows] of Array.from(groups.entries())) {
          try {
            const invoice = await createInvoiceWithNumber(
              {
                issueDate: new Date(),
                period: input.period,
                tenantName,
                totalAmount: "0.00",
                status: "issued",
              },
              rows.map(row => ({
                invoiceId: 0,
                accrualId: row.id,
                description: `Услуги проживания ${toDateOnly(row.serviceFrom)} — ${toDateOnly(row.serviceTo)}`,
                amount: row.amount,
              }))
            );
            created.push(invoice);
          } catch (error) {
            // Another request billed these accruals first: skip the group, never bill twice.
            if (error instanceof dbHelpers.AccrualsAlreadyInvoicedError)
              continue;
            throw error;
          }
        }
        return { created, skipped: accrualRows.length - draftRows.length };
      }),
    previewEmail: protectedProcedure
      .input(z.object({ invoiceId: idSchema }))
      .query(async ({ input, ctx }) => {
        const { invoice, items } = await requireInvoiceAccess(
          ctx.user,
          input.invoiceId
        );
        const recipients = await invoiceRecipients(items);
        const recipient = recipients[0] ?? null;
        const preview = buildInvoiceEmail({
          invoiceNumber: invoice.invoiceNumber,
          tenantName: invoice.tenantName,
          recipient: recipient ?? "preview@example.com",
          period: invoice.period,
          totalAmount: invoice.totalAmount,
          items: items.map(item => ({
            description: item.description,
            amount: item.amount,
          })),
        });
        return {
          recipient,
          dueDate: preview.dueDate,
          dueDateLabel: preview.dueDateLabel,
          subject: preview.subject,
          html: preview.html,
          text: preview.text,
          warnings:
            recipients.length > 1
              ? ["У начислений счета указаны разные Email; проверьте договоры"]
              : !recipient
                ? ["У плательщика не указан Email в договоре"]
                : [],
        };
      }),
    // No mail provider: the letter is opened in the user's own mail app, then marked as sent here.
    markEmailSent: protectedProcedure
      .input(z.object({ invoiceId: idSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageInvoices",
          "Недостаточно прав для отправки счетов"
        );
        const { invoice, items } = await requireInvoiceAccess(
          ctx.user,
          input.invoiceId
        );
        const recipients = await invoiceRecipients(items);
        if (!recipients.length)
          throw new Error("У плательщика не указан Email в договоре");
        if (recipients.length > 1)
          throw new Error(
            "У начислений счета указаны разные Email; проверьте договоры"
          );
        const recipient = recipients[0];
        const saved = await updateInvoiceEmail(invoice.id, {
          emailStatus: "sent",
          emailSentAt: new Date(),
          emailError: null,
        });
        return { invoice: saved, recipient };
      }),
    previewExcel: protectedProcedure
      .input(z.object({ period: periodSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageInvoices",
          "Недостаточно прав для выгрузки"
        );
        const scope = await loadScope(ctx.user);
        const accrualRows = (await listAccruals(input.period)).filter(row =>
          scope.canAccrual(row)
        );
        const errors = accrualRows.flatMap(row => {
          const contract = scope.contractOf(row);
          const messages = [];
          if (!contract && row.contractId != null)
            messages.push("Связанный договор не найден");
          if (row.contractId == null) messages.push("Начисление без договора");
          if (!(contract?.tenantName ?? row.tenantName)?.trim())
            messages.push("Не указан плательщик");
          if (!(contract?.tenantCategory ?? row.tenantCategory)?.trim())
            messages.push("Не указана категория жильца");
          if (!(contract?.tenantNumber ?? row.tenantNumber)?.trim())
            messages.push("Не указан номер жильца");
          if (!row.serviceFrom || !row.serviceTo)
            messages.push("Не указан период услуги");
          if (
            row.serviceFrom &&
            row.serviceTo &&
            toDateOnly(row.serviceFrom) > toDateOnly(row.serviceTo)
          )
            messages.push("Некорректный период услуги");
          if (!(Number(row.amount) > 0))
            messages.push("Сумма должна быть больше нуля");
          return messages.map(message => ({
            accrualId: row.id,
            contractId: row.contractId ?? null,
            contractNumber: contract?.contractNumber ?? "—",
            tenantName: contract?.tenantName ?? row.tenantName ?? "—",
            amount: Number(row.amount),
            tariffType: contract?.tariffType ?? row.tariffType ?? "monthly",
            tariffAmount: Number(
              contract?.tariffAmount ?? row.tariffAmount ?? 0
            ),
            serviceFrom: toDateOnly(row.serviceFrom),
            serviceTo: toDateOnly(row.serviceTo),
            message,
          }));
        });
        const total =
          Math.round(
            accrualRows.reduce((sum, row) => sum + Number(row.amount || 0), 0) *
              100
          ) / 100;
        return {
          period: input.period,
          totalRows: accrualRows.length,
          errorCount: errors.length,
          totalAmount: total,
          errors,
        };
      }),
    exportExcel: protectedProcedure
      .input(
        z.object({
          period: periodSchema,
          blockFolder: z.string().trim().max(120).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageInvoices",
          "Недостаточно прав для выгрузки"
        );
        if (input.blockFolder) requireBlockAccess(ctx.user, input.blockFolder);
        const scope = await loadScope(ctx.user);
        const accrualRows = (await listAccruals(input.period)).filter(
          row =>
            scope.canAccrual(row) &&
            (!input.blockFolder || scope.blockOf(row) === input.blockFolder)
        );
        const exported = await buildAccrualWorkbook(
          input.period,
          accrualRows,
          scope.visibleContracts
        );
        return {
          fileName:
            "Услуги проживания (физ лица)-" +
            input.period +
            (input.blockFolder ? "-" + input.blockFolder : "") +
            ".xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          dataBase64: Buffer.from(exported.buffer).toString("base64"),
          count: exported.count,
          errorCount: exported.errorCount,
          vatRate: exported.vatRate,
          sheetNames: exported.sheetNames,
        };
      }),
    items: protectedProcedure
      .input(z.object({ invoiceId: idSchema }))
      .query(async ({ input, ctx }) => {
        const { items } = await requireInvoiceAccess(ctx.user, input.invoiceId);
        return items;
      }),
    payments: protectedProcedure
      .input(z.object({ invoiceId: idSchema.optional() }).optional())
      .query(async ({ input, ctx }) => {
        if (input?.invoiceId) {
          await requireInvoiceAccess(ctx.user, input.invoiceId);
          return dbHelpers.listPayments(input.invoiceId);
        }
        const rows = await dbHelpers.listPayments();
        if (ctx.user.role === "admin") return rows;
        const visible = new Set(
          (await filterInvoices(ctx.user, await listInvoices())).map(
            invoice => invoice.id
          )
        );
        return rows.filter(row => visible.has(row.invoiceId));
      }),
    paymentAudit: protectedProcedure
      .input(z.object({ invoiceId: idSchema }))
      .query(async ({ input, ctx }) => {
        await requireInvoiceAccess(ctx.user, input.invoiceId);
        return dbHelpers.listPaymentAudit(input.invoiceId);
      }),
    previewPaymentImport: protectedProcedure
      .input(z.object({ dataUrl: dataUrlSchema(LIMITS.spreadsheetBytes) }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "managePayments",
          "Недостаточно прав для импорта платежей"
        );
        await enforce(RULES.spreadsheetParse, rateKey("user", ctx.user.id));
        const upload = decodeSpreadsheetUpload(input.dataUrl);
        return parsePaymentsExcel(upload.buffer);
      }),
    importPayments: protectedProcedure
      .input(
        z.object({
          rows: z.array(paymentImportRowInput).min(1).max(LIMITS.importRows),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "managePayments",
          "Недостаточно прав для импорта платежей"
        );
        // Only invoices the caller may see can receive payments.
        const invoices = await filterInvoices(ctx.user, await listInvoices());
        const imported = [];
        const errors = [];
        for (const row of input.rows) {
          const invoice = invoices.find(
            item =>
              item.invoiceNumber.trim().toLocaleLowerCase() ===
              row.invoiceNumber.trim().toLocaleLowerCase()
          );
          if (!invoice) {
            errors.push({
              invoiceNumber: row.invoiceNumber,
              message: "Счёт не найден",
            });
            continue;
          }
          // Fast path; the authoritative duplicate check runs again inside recordPayment's transaction.
          if (
            row.reference &&
            (await dbHelpers.findPaymentByReference(invoice.id, row.reference))
          ) {
            errors.push({
              invoiceNumber: row.invoiceNumber,
              message: "Платёж с таким номером транзакции уже импортирован",
            });
            continue;
          }
          try {
            imported.push(
              await dbHelpers.recordPayment(
                {
                  invoiceId: invoice.id,
                  amount: row.amount.toFixed(2),
                  paidAt: new Date(`${row.paidAt}T00:00:00Z`),
                  method: row.method,
                  reference: row.reference ?? null,
                  note: row.note ?? null,
                },
                ctx.user.id
              )
            );
          } catch (error) {
            errors.push({
              invoiceNumber: row.invoiceNumber,
              message: publicErrorMessage(error, "Не удалось записать платёж"),
            });
          }
        }
        return { imported, errors };
      }),
    recordPayment: protectedProcedure
      .input(
        z.object({
          invoiceId: idSchema,
          amount: money,
          paidAt: isoDate,
          method: z.enum(["bank", "portal", "card", "cash", "other"]),
          reference: z.string().trim().max(255).optional(),
          note: z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "managePayments",
          "Недостаточно прав для записи платежей"
        );
        await requireInvoiceAccess(ctx.user, input.invoiceId);
        return dbHelpers.recordPayment(
          {
            invoiceId: input.invoiceId,
            amount: input.amount.toFixed(2),
            paidAt: new Date(`${input.paidAt}T00:00:00Z`),
            method: input.method,
            reference: input.reference || null,
            note: input.note ?? null,
          },
          ctx.user.id
        );
      }),
    reversePayment: protectedProcedure
      .input(
        z.object({
          paymentId: idSchema,
          note: z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "managePayments",
          "Недостаточно прав для отмены платежей"
        );
        await requirePaymentAccess(ctx.user, input.paymentId);
        return dbHelpers.reversePayment(
          input.paymentId,
          ctx.user.id,
          input.note
        );
      }),
    refreshPaymentStatus: protectedProcedure
      .input(z.object({ invoiceId: idSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "managePayments",
          "Недостаточно прав для обновления статуса платежа"
        );
        await requireInvoiceAccess(ctx.user, input.invoiceId);
        return dbHelpers.recalculateInvoicePaymentStatus(input.invoiceId);
      }),
    updatePaymentStatus: protectedProcedure
      .input(
        z.object({
          invoiceId: idSchema,
          paymentStatus: z.enum([
            "issued",
            "partially_paid",
            "paid",
            "overdue",
            "disputed",
            "cancelled",
          ]),
          note: z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "managePayments",
          "Недостаточно прав для изменения статуса платежа"
        );
        await requireInvoiceAccess(ctx.user, input.invoiceId);
        return dbHelpers.updateInvoicePaymentStatus(
          input.invoiceId,
          input.paymentStatus,
          ctx.user.id,
          input.note
        );
      }),
    create: protectedProcedure
      .input(
        z.object({
          period: periodSchema,
          tenantName: z.string().trim().min(1).max(255),
          accrualIds: z.array(idSchema).min(1).max(LIMITS.bulkIds),
        })
      )
      .mutation(async ({ input, ctx }) => {
        assertPermission(
          ctx.user.role,
          "manageInvoices",
          "Недостаточно прав для создания счета"
        );
        const ids = Array.from(new Set(input.accrualIds));
        const scope = await loadScope(ctx.user);
        const rows = await listAccruals(input.period);
        const selected = rows.filter(row => ids.includes(row.id));
        // Every requested accrual must exist in this period, be visible to the caller and be a draft.
        if (selected.length !== ids.length)
          throw new Error(
            "Некоторые начисления не найдены в выбранном периоде"
          );
        if (selected.some(row => !scope.canAccrual(row)))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Нет доступа к начислению: блок не назначен менеджеру",
          });
        if (selected.some(row => row.status !== "draft"))
          throw new Error("Часть начислений уже включена в счёт");
        const tenantNames = Array.from(
          new Set(
            selected
              .map(row =>
                (scope.contractOf(row)?.tenantName ?? row.tenantName)?.trim()
              )
              .filter(Boolean)
          )
        );
        if (tenantNames.length !== 1)
          throw new Error(
            "Для одного счёта выберите начисления одного плательщика"
          );
        if (input.tenantName.trim() !== tenantNames[0])
          throw new Error(
            "Имя плательщика не совпадает с выбранными начислениями"
          );
        try {
          return await createInvoiceWithNumber(
            {
              issueDate: new Date(),
              period: input.period,
              tenantName: tenantNames[0]!,
              totalAmount: "0.00",
              status: "issued",
            },
            selected.map(row => ({
              invoiceId: 0,
              accrualId: row.id,
              description: `Услуги проживания ${toDateOnly(row.serviceFrom)} — ${toDateOnly(row.serviceTo)}`,
              amount: row.amount,
            }))
          );
        } catch (error) {
          if (error instanceof dbHelpers.AccrualsAlreadyInvoicedError)
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          throw error;
        }
      }),
  }),
});
export type AppRouter = typeof appRouter;
