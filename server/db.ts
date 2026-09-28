import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  users,
  contracts,
  documents,
  accruals,
  invoices,
  invoiceItems,
  payments,
  paymentAudit,
  departments,
  documentPermissions,
  contractAuditLog,
  contractFolders,
  authSessions,
  securityAuditLog,
} from "../drizzle/schema";
import { shouldAutoArchiveContract } from "@shared/contractLifecycle";

let _db: ReturnType<typeof drizzle> | null = null;
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
    }
  }
  return _db;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function listContractFolders() {
  const db = await getDb();
  return db
    ? db.select().from(contractFolders).orderBy(contractFolders.name)
    : [];
}
export async function createContractFolder(name: string) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const result = await db.insert(contractFolders).values({ name: name.trim() });
  const rows = await db
    .select()
    .from(contractFolders)
    .where(eq(contractFolders.id, Number(result[0].insertId)))
    .limit(1);
  return rows[0];
}
export async function renameContractFolder(
  id: number,
  name: string,
  _clientOldName?: string
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  // The old name comes from the database, not from the request: a forged "oldName" must not
  // move contracts out of an unrelated folder.
  await db.transaction(async tx => {
    const [folder] = await tx
      .select()
      .from(contractFolders)
      .where(eq(contractFolders.id, id))
      .for("update");
    if (!folder) throw new Error("Папка не найдена");
    await tx
      .update(contractFolders)
      .set({ name: name.trim() })
      .where(eq(contractFolders.id, id));
    await tx
      .update(contracts)
      .set({ blockFolder: name.trim() })
      .where(eq(contracts.blockFolder, folder.name));
  });
  return { id, name: name.trim() };
}
export async function deleteContractFolder(id: number) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const rows = await db
    .select()
    .from(contractFolders)
    .where(eq(contractFolders.id, id))
    .limit(1);
  if (!rows[0]) throw new Error("Папка не найдена");
  const used = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.blockFolder, rows[0].name))
    .limit(1);
  if (used.length) throw new Error("Сначала перенесите договоры из папки");
  await db.delete(contractFolders).where(eq(contractFolders.id, id));
  return { success: true, id };
}
export async function moveContractsToFolder(ids: number[], folderName: string) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  if (!ids.length) return { moved: 0 };
  for (const id of ids)
    await db
      .update(contracts)
      .set({ blockFolder: folderName.trim() })
      .where(eq(contracts.id, id));
  return { moved: ids.length, folderName: folderName.trim() };
}
export async function listContracts(includeArchived = false) {
  const db = await getDb();
  if (!db) return [];
  await archiveExpiredContracts();
  return db
    .select()
    .from(contracts)
    .where(includeArchived ? undefined : isNull(contracts.archivedAt))
    .orderBy(desc(contracts.updatedAt));
}
export async function getContract(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);
  return rows[0];
}
export async function createContract(input: typeof contracts.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const result = await db.insert(contracts).values(input);
  return getContract(Number(result[0].insertId));
}
export async function updateContract(
  id: number,
  input: Partial<typeof contracts.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  await db.update(contracts).set(input).where(eq(contracts.id, id));
  return getContract(id);
}
export async function deleteContract(id: number) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const linkedAccruals = await db
    .select({ id: accruals.id })
    .from(accruals)
    .where(eq(accruals.contractId, id))
    .limit(1);
  const linkedDocuments = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.contractId, id))
    .limit(1);
  if (linkedAccruals.length || linkedDocuments.length)
    throw new Error(
      "Договор нельзя удалить: к нему уже привязаны начисления или документы. Сначала проверьте связанные данные."
    );
  await db.delete(contracts).where(eq(contracts.id, id));
  return { success: true, id };
}
export async function permanentlyDeleteContract(id: number) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const contractsFound = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);
  const contract = contractsFound[0];
  if (!contract) throw new Error("Договор не найден");

  // Permanent contract deletion is allowed even when accruals were already billed.
  // We preserve financial history by detaching the accruals from the deleted contract
  // instead of deleting invoiceItems/accruals. This keeps invoices and payment history intact.
  const linkedAccruals = await db
    .select({ id: accruals.id })
    .from(accruals)
    .where(eq(accruals.contractId, id));
  const linkedDocuments = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.contractId, id));

  await db.transaction(async tx => {
    if (linkedAccruals.length) {
      await tx
        .update(accruals)
        .set({ contractId: null })
        .where(
          inArray(
            accruals.id,
            linkedAccruals.map(row => row.id)
          )
        );
    }
    for (const document of linkedDocuments) {
      await tx
        .delete(documentPermissions)
        .where(eq(documentPermissions.documentId, document.id));
      await tx.delete(documents).where(eq(documents.id, document.id));
    }
    await tx
      .delete(contractAuditLog)
      .where(eq(contractAuditLog.contractId, id));
    await tx.delete(contracts).where(eq(contracts.id, id));
  });

  return {
    success: true,
    id,
    detachedAccruals: linkedAccruals.length,
    deletedDocuments: linkedDocuments.length,
  };
}

export async function permanentlyDeleteContracts(ids: number[]) {
  if (!ids.length) throw new Error("Выберите хотя бы один договор");
  let detachedAccruals = 0;
  let deletedDocuments = 0;
  for (const id of ids) {
    const result = await permanentlyDeleteContract(id);
    detachedAccruals += result.detachedAccruals;
    deletedDocuments += result.deletedDocuments;
  }
  return {
    success: true,
    ids,
    deletedContracts: ids.length,
    detachedAccruals,
    deletedDocuments,
  };
}
export async function archiveContract(id: number) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  await db
    .update(contracts)
    .set({ archivedAt: new Date() })
    .where(eq(contracts.id, id));
  return { success: true, id, archived: true };
}
export async function restoreContract(id: number) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  await db
    .update(contracts)
    .set({ archivedAt: null })
    .where(eq(contracts.id, id));
  return { success: true, id, archived: false };
}
export async function archiveExpiredContracts(
  today = new Date().toISOString().slice(0, 10)
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const activeRows = await db
    .select()
    .from(contracts)
    .where(isNull(contracts.archivedAt));
  const expired = activeRows.filter(contract =>
    shouldAutoArchiveContract(contract, today)
  );
  for (const contract of expired) {
    await db
      .update(contracts)
      .set({ archivedAt: new Date() })
      .where(eq(contracts.id, contract.id));
    await db.insert(contractAuditLog).values({
      contractId: contract.id,
      actorUserId: null,
      action: "updated",
      details: contract.terminationDate
        ? "Автоматическое архивирование после досрочного расторжения"
        : "Автоматическое архивирование по дате окончания",
    });
  }
  return {
    archived: expired.length,
    ids: expired.map(contract => contract.id),
  };
}

export async function listDocuments(contractId?: number) {
  const db = await getDb();
  if (!db) return [];
  return contractId
    ? db
        .select()
        .from(documents)
        .where(eq(documents.contractId, contractId))
        .orderBy(desc(documents.createdAt))
    : db.select().from(documents).orderBy(desc(documents.createdAt));
}
export async function getDocument(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return rows[0];
}
export async function deleteDocument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const document = await getDocument(id);
  if (!document) throw new Error("Скан не найден");
  await db.transaction(async tx => {
    await tx
      .delete(documentPermissions)
      .where(eq(documentPermissions.documentId, id));
    await tx.delete(documents).where(eq(documents.id, id));
  });
  return document;
}
export async function updateDocumentStorage(
  id: number,
  input: Pick<
    typeof documents.$inferInsert,
    | "fileKey"
    | "fileUrl"
    | "encryptionVersion"
    | "encryptionIv"
    | "encryptionAuthTag"
  >
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  await db.update(documents).set(input).where(eq(documents.id, id));
  return getDocument(id);
}
export async function listDepartments() {
  const db = await getDb();
  return db ? db.select().from(departments).orderBy(departments.name) : [];
}
export async function createDepartment(name: string) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const result = await db.insert(departments).values({ name });
  const rows = await db
    .select()
    .from(departments)
    .where(eq(departments.id, Number(result[0].insertId)))
    .limit(1);
  return rows[0];
}
export async function listUsers() {
  const db = await getDb();
  return db
    ? db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          accountStatus: users.accountStatus,
          departmentId: users.departmentId,
          managedBlocks: users.managedBlocks,
          mustChangePassword: users.mustChangePassword,
          temporaryPasswordExpiresAt: users.temporaryPasswordExpiresAt,
          hasPassword: sql<number>`(${users.passwordHash} is not null)`,
          lastSignedIn: users.lastSignedIn,
        })
        .from(users)
        .orderBy(users.name)
    : [];
}
export async function countActiveAdmins(excludeUserId?: number) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const conditions = [
    eq(users.role, "admin"),
    eq(users.accountStatus, "active"),
  ];
  if (excludeUserId !== undefined)
    conditions.push(sql`${users.id} <> ${excludeUserId}` as never);
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(...conditions));
  return Number(rows[0]?.count ?? 0);
}
export async function updateUserAccess(
  id: number,
  input: Partial<typeof users.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  await db.update(users).set(input).where(eq(users.id, id));
  return listUsers();
}
export async function updateUserAccessWithAudit(input: {
  actorUserId: number;
  targetUserId: number;
  role: "admin" | "manager";
  departmentId: number | null;
  managedBlocks: string | null;
  accountStatus: "pending" | "active" | "disabled";
}) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const target = await getUserById(input.targetUserId);
  if (!target) throw new Error("Пользователь не найден");
  const adminWouldDisappear =
    target.role === "admin" &&
    target.accountStatus === "active" &&
    (input.role !== "admin" || input.accountStatus !== "active");
  if (adminWouldDisappear && (await countActiveAdmins(input.targetUserId)) < 1)
    throw new Error("Нельзя оставить систему без активного администратора");
  await db.transaction(async tx => {
    await tx
      .update(users)
      .set({
        role: input.role,
        departmentId: input.departmentId,
        managedBlocks: input.managedBlocks,
        accountStatus: input.accountStatus,
      })
      .where(eq(users.id, input.targetUserId));
    const auditRows: Array<typeof securityAuditLog.$inferInsert> = [];
    if (target.role !== input.role)
      auditRows.push({
        eventType: "user_role_changed",
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        oldValue: target.role,
        newValue: input.role,
      });
    if ((target.departmentId ?? null) !== input.departmentId)
      auditRows.push({
        eventType: "user_department_changed",
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        oldValue: String(target.departmentId ?? ""),
        newValue: String(input.departmentId ?? ""),
      });
    if ((target.managedBlocks ?? null) !== input.managedBlocks)
      auditRows.push({
        eventType: "user_blocks_changed",
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        oldValue: target.managedBlocks ?? "",
        newValue: input.managedBlocks ?? "",
      });
    if (target.accountStatus !== input.accountStatus)
      auditRows.push({
        eventType:
          input.accountStatus === "active" ? "user_activated" : "user_disabled",
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        oldValue: target.accountStatus,
        newValue: input.accountStatus,
      });
    for (const audit of auditRows)
      await tx.insert(securityAuditLog).values(audit);
  });
  return listUsers();
}
export async function listDocumentPermissions(documentId?: number) {
  const db = await getDb();
  if (!db) return [];
  return documentId
    ? db
        .select()
        .from(documentPermissions)
        .where(eq(documentPermissions.documentId, documentId))
    : db.select().from(documentPermissions);
}
export async function upsertDocumentPermission(
  input: typeof documentPermissions.$inferInsert
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const existing = await db
    .select()
    .from(documentPermissions)
    .where(
      and(
        eq(documentPermissions.documentId, input.documentId),
        input.userId
          ? eq(documentPermissions.userId, input.userId)
          : eq(documentPermissions.departmentId, input.departmentId!)
      )
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(documentPermissions)
      .set({ canView: input.canView })
      .where(eq(documentPermissions.id, existing[0].id));
    return existing[0];
  }
  const result = await db.insert(documentPermissions).values(input);
  const rows = await db
    .select()
    .from(documentPermissions)
    .where(eq(documentPermissions.id, Number(result[0].insertId)))
    .limit(1);
  return rows[0];
}
export async function deleteDocumentPermission(id: number) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  await db.delete(documentPermissions).where(eq(documentPermissions.id, id));
  return { success: true };
}
export async function createContractAudit(
  input: typeof contractAuditLog.$inferInsert
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const result = await db.insert(contractAuditLog).values(input);
  const rows = await db
    .select()
    .from(contractAuditLog)
    .where(eq(contractAuditLog.id, Number(result[0].insertId)))
    .limit(1);
  return rows[0];
}
export async function listContractAudit(contractId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(contractAuditLog)
    .where(eq(contractAuditLog.contractId, contractId))
    .orderBy(desc(contractAuditLog.createdAt));
}
export async function createDocument(input: typeof documents.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const result = await db.insert(documents).values(input);
  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.id, Number(result[0].insertId)))
    .limit(1);
  return rows[0];
}

export async function listAccruals(period?: string) {
  const db = await getDb();
  if (!db) return [];
  return period
    ? db
        .select()
        .from(accruals)
        .where(eq(accruals.period, period))
        .orderBy(desc(accruals.createdAt))
    : db.select().from(accruals).orderBy(desc(accruals.createdAt));
}
export async function createAccrual(input: typeof accruals.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const result = await db.insert(accruals).values(input);
  const rows = await db
    .select()
    .from(accruals)
    .where(eq(accruals.id, Number(result[0].insertId)))
    .limit(1);
  return rows[0];
}
export async function updateAccrual(
  id: number,
  input: Partial<typeof accruals.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  await db.update(accruals).set(input).where(eq(accruals.id, id));
  const rows = await db
    .select()
    .from(accruals)
    .where(eq(accruals.id, id))
    .limit(1);
  return rows[0];
}
export async function markAccrualsInvoiced(ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  for (const id of ids)
    await db
      .update(accruals)
      .set({ status: "invoiced" })
      .where(eq(accruals.id, id));
}
export async function deleteAccrual(id: number) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const rows = await db
    .select()
    .from(accruals)
    .where(eq(accruals.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("Начисление не найдено");
  if (row.status === "invoiced")
    throw new Error("Начисление в счёте нельзя удалять");
  const linked = await db
    .select({ id: invoiceItems.id })
    .from(invoiceItems)
    .where(eq(invoiceItems.accrualId, id))
    .limit(1);
  if (linked.length)
    throw new Error("Начисление связано со счётом и не может быть удалено");
  // Conditional delete: if the accrual was invoiced in the meantime, nothing is removed.
  const result = await db
    .delete(accruals)
    .where(and(eq(accruals.id, id), eq(accruals.status, "draft")));
  if (Number((result as any)[0]?.affectedRows ?? 1) === 0)
    throw new Error("Начисление в счёте нельзя удалять");
  return row;
}
/** Edits an accrual only while it is still a draft (atomic with respect to invoicing). */
export async function updateDraftAccrual(
  id: number,
  input: Partial<typeof accruals.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const result = await db
    .update(accruals)
    .set(input)
    .where(and(eq(accruals.id, id), eq(accruals.status, "draft")));
  if (Number((result as any)[0]?.affectedRows ?? 1) === 0)
    throw new Error("Начисление в счёте нельзя изменять");
  const rows = await db
    .select()
    .from(accruals)
    .where(eq(accruals.id, id))
    .limit(1);
  return rows[0];
}
export async function clearDraftAccruals(period?: string) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const candidates = period
    ? await db
        .select()
        .from(accruals)
        .where(and(eq(accruals.period, period), eq(accruals.status, "draft")))
    : await db.select().from(accruals).where(eq(accruals.status, "draft"));
  let deleted = 0;
  let skipped = 0;
  for (const row of candidates) {
    const linked = await db
      .select({ id: invoiceItems.id })
      .from(invoiceItems)
      .where(eq(invoiceItems.accrualId, row.id))
      .limit(1);
    if (linked.length) {
      skipped++;
      continue;
    }
    const result = await db
      .delete(accruals)
      .where(and(eq(accruals.id, row.id), eq(accruals.status, "draft")));
    if (Number((result as any)[0]?.affectedRows ?? 1) === 0) {
      skipped++;
      continue;
    }
    deleted++;
  }
  return { deleted, skipped, requested: candidates.length };
}

export async function listInvoices() {
  const db = await getDb();
  return db ? db.select().from(invoices).orderBy(desc(invoices.createdAt)) : [];
}
export async function getInvoice(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1);
  return rows[0];
}
export async function updateInvoiceEmail(
  id: number,
  input: Partial<typeof invoices.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  await db.update(invoices).set(input).where(eq(invoices.id, id));
  return getInvoice(id);
}
export async function getInvoiceItems(invoiceId: number) {
  const db = await getDb();
  return db
    ? db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, invoiceId))
    : [];
}
export async function listPayments(invoiceId?: number) {
  const db = await getDb();
  if (!db) return [];
  return invoiceId
    ? db
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, invoiceId))
        .orderBy(desc(payments.createdAt))
    : db.select().from(payments).orderBy(desc(payments.createdAt));
}
export async function findPaymentByReference(
  invoiceId: number,
  reference: string
) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(payments)
    .where(
      and(eq(payments.invoiceId, invoiceId), eq(payments.reference, reference))
    )
    .limit(1);
  return rows[0];
}
export async function listPaymentAudit(invoiceId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(paymentAudit)
    .where(eq(paymentAudit.invoiceId, invoiceId))
    .orderBy(desc(paymentAudit.createdAt));
}
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

const toCents = (value: unknown) => Math.round(Number(value) * 100);

/** Payment status derived from posted payments; runs inside the caller's transaction. */
async function recalculateStatusWith(ex: Executor, invoiceId: number) {
  const [invoice] = await ex
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw new Error("Счёт не найден");
  const [{ paidCents }] = await ex
    .select({
      paidCents: sql<string>`coalesce(sum(round(${payments.amount} * 100)), 0)`,
    })
    .from(payments)
    .where(
      and(eq(payments.invoiceId, invoiceId), eq(payments.status, "posted"))
    );
  const paid = Number(paidCents);
  const total = toCents(invoice.totalAmount);
  const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
  const paymentStatus =
    invoice.status === "cancelled"
      ? "cancelled"
      : paid >= total
        ? "paid"
        : paid > 0
          ? "partially_paid"
          : due && due < new Date()
            ? "overdue"
            : "issued";
  await ex
    .update(invoices)
    .set({ paymentStatus })
    .where(eq(invoices.id, invoiceId));
  return {
    invoice: { ...invoice, paymentStatus },
    paidAmount: paid / 100,
    outstandingAmount: Math.max(0, total - paid) / 100,
  };
}

export async function recalculateInvoicePaymentStatus(invoiceId: number) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  return db.transaction(async tx => {
    await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .for("update");
    return recalculateStatusWith(tx, invoiceId);
  });
}

/**
 * Records a payment atomically: the invoice row is locked (SELECT … FOR UPDATE), so two concurrent
 * payments are serialised and the second one sees the first — an invoice can never be overpaid.
 */
export async function recordPayment(
  input: typeof payments.$inferInsert,
  actorUserId: number
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const amountCents = toCents(input.amount);
  if (!Number.isFinite(amountCents) || amountCents <= 0)
    throw new Error("Сумма платежа должна быть больше нуля");
  const paymentId = await db.transaction(async tx => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .for("update");
    if (!invoice) throw new Error("Счёт не найден");
    if (invoice.status === "cancelled" || invoice.paymentStatus === "cancelled")
      throw new Error("Счёт отменён: платежи по нему не принимаются");
    if (input.reference) {
      const [duplicate] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.invoiceId, input.invoiceId),
            eq(payments.reference, input.reference),
            eq(payments.status, "posted")
          )
        )
        .limit(1);
      if (duplicate)
        throw new Error("Платёж с таким номером транзакции уже записан");
    }
    const current = await recalculateStatusWith(tx, input.invoiceId);
    if (amountCents > Math.round(current.outstandingAmount * 100))
      throw new Error("Сумма платежа превышает остаток по счёту");
    const result = await tx.insert(payments).values({
      ...input,
      amount: (amountCents / 100).toFixed(2),
      createdBy: actorUserId,
      status: "posted",
    });
    const id = Number(result[0].insertId);
    await tx.insert(paymentAudit).values({
      paymentId: id,
      invoiceId: input.invoiceId,
      action: "recorded",
      amount: (amountCents / 100).toFixed(2),
      actorUserId,
      note: input.note ?? null,
    });
    await recalculateStatusWith(tx, input.invoiceId);
    return id;
  });
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  return rows[0];
}

export async function getPayment(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.id, id))
    .limit(1);
  return rows[0];
}

/** Reverses a payment once: the status flip is conditional, so a replayed request changes nothing. */
export async function reversePayment(
  paymentId: number,
  actorUserId: number,
  note?: string
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  return db.transaction(async tx => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update");
    if (!payment) throw new Error("Платёж не найден");
    if (payment.status === "reversed") throw new Error("Платёж уже отменён");
    await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.id, payment.invoiceId))
      .for("update");
    const result = await tx
      .update(payments)
      .set({ status: "reversed" })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "posted")));
    if (Number((result as any)[0]?.affectedRows ?? 0) !== 1)
      throw new Error("Платёж уже отменён");
    await tx.insert(paymentAudit).values({
      paymentId,
      invoiceId: payment.invoiceId,
      action: "reversed",
      amount: payment.amount,
      actorUserId,
      note: note ?? null,
    });
    return recalculateStatusWith(tx, payment.invoiceId);
  });
}

export async function updateInvoicePaymentStatus(
  id: number,
  paymentStatus: typeof invoices.$inferInsert.paymentStatus,
  actorUserId: number,
  note?: string
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  await db.transaction(async tx => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .for("update");
    if (!invoice) throw new Error("Счёт не найден");
    await tx.update(invoices).set({ paymentStatus }).where(eq(invoices.id, id));
    await tx.insert(paymentAudit).values({
      paymentId: null,
      invoiceId: id,
      action: "status_changed",
      amount: "0.00",
      previousStatus: invoice.paymentStatus,
      newStatus: paymentStatus,
      actorUserId,
      note: note ?? null,
    });
  });
  return getInvoice(id);
}

export class AccrualsAlreadyInvoicedError extends Error {
  constructor() {
    super("Часть начислений уже включена в другой счёт — обновите страницу");
    this.name = "AccrualsAlreadyInvoicedError";
  }
}

/**
 * Creates an invoice from draft accruals atomically. The accrual rows are locked, must all still be
 * drafts that are not part of any invoice, and are switched to "invoiced" in the same transaction —
 * so concurrent requests cannot put one accrual into two invoices.
 */
export async function createInvoice(
  input: typeof invoices.$inferInsert,
  items: Array<typeof invoiceItems.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const accrualIds = Array.from(new Set(items.map(item => item.accrualId)));
  const invoiceId = await db.transaction(async tx => {
    if (accrualIds.length) {
      const locked = await tx
        .select({
          id: accruals.id,
          status: accruals.status,
          amount: accruals.amount,
        })
        .from(accruals)
        .where(inArray(accruals.id, accrualIds))
        .for("update");
      if (
        locked.length !== accrualIds.length ||
        locked.some(row => row.status !== "draft")
      )
        throw new AccrualsAlreadyInvoicedError();
      const linked = await tx
        .select({ id: invoiceItems.id })
        .from(invoiceItems)
        .where(inArray(invoiceItems.accrualId, accrualIds))
        .limit(1);
      if (linked.length) throw new AccrualsAlreadyInvoicedError();
      // Line amounts and the total come from the locked rows, never from the caller.
      const lockedAmount = new Map(locked.map(row => [row.id, row.amount]));
      items = items.map(item => ({
        ...item,
        amount: lockedAmount.get(item.accrualId)!,
      }));
      const totalCents = locked.reduce(
        (sum, row) => sum + toCents(row.amount),
        0
      );
      input = { ...input, totalAmount: (totalCents / 100).toFixed(2) };
    }
    const result = await tx.insert(invoices).values(input);
    const id = Number(result[0].insertId);
    if (items.length)
      await tx
        .insert(invoiceItems)
        .values(items.map(item => ({ ...item, invoiceId: id })));
    if (accrualIds.length) {
      const updated = await tx
        .update(accruals)
        .set({ status: "invoiced" })
        .where(
          and(inArray(accruals.id, accrualIds), eq(accruals.status, "draft"))
        );
      if (Number((updated as any)[0]?.affectedRows ?? 0) !== accrualIds.length)
        throw new AccrualsAlreadyInvoicedError();
    }
    return id;
  });
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  return rows[0];
}

export async function getAccrual(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(accruals)
    .where(eq(accruals.id, id))
    .limit(1);
  return rows[0];
}
export async function listAccrualsByIds(ids: number[]) {
  const db = await getDb();
  if (!db || !ids.length) return [];
  return db.select().from(accruals).where(inArray(accruals.id, ids));
}
export async function listAllInvoiceItems() {
  const db = await getDb();
  return db ? db.select().from(invoiceItems) : [];
}

export async function listPermanentlyDeletableContractIds() {
  const db = await getDb();
  if (!db) return [];

  // Permanent deletion is an Administrator-only operation and is allowed even when
  // the contract has accruals or invoice items. The delete operation detaches the
  // accruals so invoice and payment history remains intact.
  const rows = await db
    .select({ id: contracts.id })
    .from(contracts);

  return rows.map(row => row.id);
}

export async function getUserByEmailNormalized(emailNormalized: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);
  return rows[0];
}
export async function createLocalUser(input: {
  name: string;
  email: string;
  emailNormalized: string;
  passwordHash?: string | null;
  accountStatus?: "pending" | "active" | "disabled";
  role: "admin" | "manager";
  departmentId?: number | null;
  managedBlocks?: string | null;
  mustChangePassword?: boolean;
  temporaryPasswordExpiresAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const result = await db.insert(users).values({
    name: input.name,
    email: input.email,
    emailNormalized: input.emailNormalized,
    passwordHash: input.passwordHash ?? null,
    accountStatus: input.accountStatus ?? "pending",
    loginMethod: "local",
    role: input.role,
    departmentId: input.departmentId ?? null,
    managedBlocks: input.managedBlocks ?? null,
    mustChangePassword: input.mustChangePassword ?? false,
    temporaryPasswordExpiresAt: input.temporaryPasswordExpiresAt ?? null,
    passwordChangedAt: input.passwordHash ? new Date() : null,
  });
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, Number(result[0].insertId)))
    .limit(1);
  return rows[0];
}
export async function updateUserLocalAuth(
  id: number,
  input: Partial<typeof users.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  await db.update(users).set(input).where(eq(users.id, id));
  return getUserById(id);
}
export async function createAuthSession(
  input: typeof authSessions.$inferInsert
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const result = await db.insert(authSessions).values(input);
  const rows = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.id, Number(result[0].insertId)))
    .limit(1);
  return rows[0];
}
export async function getAuthSessionUser(tokenHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({ session: authSessions, user: users })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(eq(authSessions.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}
export async function updateAuthSessionSeen(id: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(authSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(authSessions.id, id));
}
export async function purgeExpiredAuthSessions(before = new Date()) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(authSessions)
    .where(sql`${authSessions.expiresAt} < ${before}`);
}
export async function revokeAuthSession(tokenHash: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt))
    );
}
export async function revokeUserSessions(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt))
    );
}
export async function createSecurityAuditEvent(
  input: typeof securityAuditLog.$inferInsert
) {
  const db = await getDb();
  if (!db) throw new Error("База данных недоступна");
  const result = await db.insert(securityAuditLog).values(input);
  const rows = await db
    .select()
    .from(securityAuditLog)
    .where(eq(securityAuditLog.id, Number(result[0].insertId)))
    .limit(1);
  return rows[0];
}
export async function listSecurityAuditEvents() {
  const db = await getDb();
  return db
    ? db
        .select()
        .from(securityAuditLog)
        .orderBy(desc(securityAuditLog.createdAt))
        .limit(500)
    : [];
}
