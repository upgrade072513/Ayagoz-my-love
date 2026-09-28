// Central authorization layer. Every procedure or route that receives an object ID goes through
// one of the require*Access helpers below; nothing relies on the UI hiding buttons.
//
// Access model (see shared/accessControl.ts):
//  - admin   — all objects;
//  - manager — only objects in the blocks listed in users.managedBlocks.
// The block of an object:
//  - contract         → its block folder (derived from address/room when not set explicitly);
//  - accrual          → block of its contract, or (no contract) derived from its own address/room;
//  - invoice          → all of its accruals must be accessible;
//  - payment          → its invoice must be accessible;
//  - contract document → contract block + per-document rules (canViewDocument).
import { TRPCError } from "@trpc/server";
import { deriveBlockFolder } from "@shared/contractFolder";
import { canAccessContractBlock, canViewDocument } from "@shared/access";
import type { Accrual, Contract, Invoice } from "../drizzle/schema";
import * as db from "./db";

export type Actor = {
  id: number;
  role: string;
  managedBlocks?: string | null;
  departmentId?: number | null;
};

export const isAdmin = (actor: Actor) => actor.role === "admin";

const forbidden = (message: string) =>
  new TRPCError({ code: "FORBIDDEN", message });
const notFound = (message: string) =>
  new TRPCError({ code: "NOT_FOUND", message });

type ContractLike = Pick<Contract, "propertyName" | "unitName" | "blockFolder">;
type AccrualLike = Pick<Accrual, "contractId" | "propertyName" | "unitName">;

export const contractBlock = (
  contract: Partial<ContractLike> | null | undefined
) =>
  contract
    ? deriveBlockFolder(
        contract.propertyName,
        contract.unitName,
        contract.blockFolder
      )
    : null;

export const accrualBlock = (
  accrual: Partial<AccrualLike>,
  contract: Partial<ContractLike> | null | undefined
) =>
  accrual.contractId != null
    ? contractBlock(contract)
    : deriveBlockFolder(accrual.propertyName, accrual.unitName, null);

export const canAccessContract = (
  actor: Actor,
  contract: Partial<ContractLike> | null | undefined
) =>
  Boolean(contract) &&
  (isAdmin(actor) || canAccessContractBlock(actor, contractBlock(contract)));

export const canAccessAccrual = (
  actor: Actor,
  accrual: Partial<AccrualLike>,
  contract: Partial<ContractLike> | null | undefined
) => {
  if (isAdmin(actor)) return true;
  if (accrual.contractId != null && !contract) return false; // orphaned row: admin only
  return canAccessContractBlock(actor, accrualBlock(accrual, contract));
};

export const canAccessBlock = (
  actor: Actor,
  block: string | null | undefined
) => isAdmin(actor) || canAccessContractBlock(actor, block);

export function requireBlock(actor: Actor, block: string | null | undefined) {
  if (!canAccessBlock(actor, block))
    throw forbidden("Нет доступа к этому блоку: он не назначен менеджеру");
}

// ---------------------------------------------------------------- contracts
export async function requireContractAccess(actor: Actor, contractId: number) {
  const contract = await db.getContract(contractId);
  if (!contract) throw notFound("Договор не найден");
  if (!canAccessContract(actor, contract))
    throw forbidden("Нет доступа к договору: блок не назначен менеджеру");
  return contract;
}

// ---------------------------------------------------------------- accruals
export async function requireAccrualAccess(actor: Actor, accrualId: number) {
  const accrual = await db.getAccrual(accrualId);
  if (!accrual) throw notFound("Начисление не найдено");
  const contract =
    accrual.contractId == null
      ? null
      : await db.getContract(accrual.contractId);
  if (!canAccessAccrual(actor, accrual, contract))
    throw forbidden("Нет доступа к начислению: блок не назначен менеджеру");
  return { accrual, contract: contract ?? null };
}

/**
 * Preloads contracts once and answers access questions for many rows (lists, exports, bulk jobs).
 */
export async function loadScope(actor: Actor) {
  const contracts = await db.listContracts(true);
  const contractById = new Map(
    contracts.map(contract => [contract.id, contract])
  );
  const contractOf = (accrual: AccrualLike) =>
    accrual.contractId == null
      ? null
      : (contractById.get(accrual.contractId) ?? null);
  return {
    contracts,
    contractById,
    contractOf,
    visibleContracts: isAdmin(actor)
      ? contracts
      : contracts.filter(contract => canAccessContract(actor, contract)),
    canContract: (contract: ContractLike | null | undefined) =>
      canAccessContract(actor, contract),
    canAccrual: (accrual: AccrualLike) =>
      canAccessAccrual(actor, accrual, contractOf(accrual)),
    blockOf: (accrual: AccrualLike) =>
      accrualBlock(accrual, contractOf(accrual)),
  };
}
export type Scope = Awaited<ReturnType<typeof loadScope>>;

export async function filterAccruals<T extends AccrualLike>(
  actor: Actor,
  rows: T[]
) {
  if (isAdmin(actor)) return rows;
  const scope = await loadScope(actor);
  return rows.filter(row => scope.canAccrual(row));
}

// ---------------------------------------------------------------- invoices
/** An invoice is visible to a manager only if every accrual it bills is in the manager's blocks. */
function invoiceVisible(
  scope: Scope,
  itemAccrualIds: number[],
  accrualById: Map<number, Accrual>
) {
  if (!itemAccrualIds.length) return false;
  return itemAccrualIds.every(id => {
    const accrual = accrualById.get(id);
    return Boolean(accrual) && scope.canAccrual(accrual!);
  });
}

export async function requireInvoiceAccess(actor: Actor, invoiceId: number) {
  const invoice = await db.getInvoice(invoiceId);
  if (!invoice) throw notFound("Счёт не найден");
  const items = await db.getInvoiceItems(invoice.id);
  if (isAdmin(actor)) return { invoice, items };
  const accrualRows = await db.listAccrualsByIds(
    items.map(item => item.accrualId)
  );
  const scope = await loadScope(actor);
  const accrualById = new Map(accrualRows.map(row => [row.id, row]));
  if (
    !invoiceVisible(
      scope,
      items.map(item => item.accrualId),
      accrualById
    )
  )
    throw forbidden(
      "Нет доступа к счёту: он относится к блоку, не назначенному менеджеру"
    );
  return { invoice, items };
}

/** Returns only the invoices the actor may see (one query for all items and accruals). */
export async function filterInvoices<T extends Pick<Invoice, "id">>(
  actor: Actor,
  invoices: T[]
) {
  if (isAdmin(actor)) return invoices;
  const [items, scope] = await Promise.all([
    db.listAllInvoiceItems(),
    loadScope(actor),
  ]);
  const accrualRows = await db.listAccrualsByIds(
    Array.from(new Set(items.map(item => item.accrualId)))
  );
  const accrualById = new Map(accrualRows.map(row => [row.id, row]));
  const itemsByInvoice = new Map<number, number[]>();
  for (const item of items) {
    const list = itemsByInvoice.get(item.invoiceId) ?? [];
    list.push(item.accrualId);
    itemsByInvoice.set(item.invoiceId, list);
  }
  return invoices.filter(invoice =>
    invoiceVisible(scope, itemsByInvoice.get(invoice.id) ?? [], accrualById)
  );
}

// ---------------------------------------------------------------- payments
export async function requirePaymentAccess(actor: Actor, paymentId: number) {
  const payment = await db.getPayment(paymentId);
  if (!payment) throw notFound("Платёж не найден");
  await requireInvoiceAccess(actor, payment.invoiceId);
  return payment;
}

// ---------------------------------------------------------------- documents
export async function requireDocumentAccess(
  actor: Actor,
  documentId: number,
  mode: "view" | "manage"
) {
  const document = await db.getDocument(documentId);
  if (!document) throw notFound("Документ не найден");
  const contract = await db.getContract(document.contractId);
  if (!contract) throw forbidden("Нет доступа к документу");
  if (mode === "manage") {
    if (!canAccessContract(actor, contract))
      throw forbidden("Нет доступа к договору");
  } else {
    const permissions = await db.listDocumentPermissions(document.id);
    if (
      !canAccessContract(actor, contract) ||
      !canViewDocument(actor, contract, permissions)
    )
      throw forbidden("Нет доступа к документу");
  }
  return { document, contract };
}
