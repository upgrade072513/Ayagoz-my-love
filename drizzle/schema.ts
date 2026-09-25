import { int, index, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, date, boolean } from "drizzle-orm/mysql-core";

export const departments = mysqlTable("departments", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const contractFolders = mysqlTable("contractFolders", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  emailNormalized: varchar("emailNormalized", { length: 320 }).unique(),
  passwordHash: text("passwordHash"),
  accountStatus: mysqlEnum("accountStatus", ["pending", "active", "disabled"]).default("pending").notNull(),
  passwordChangedAt: timestamp("passwordChangedAt"),
  /** Set when an administrator issued a one-time password; the user must choose a new password before doing anything else. */
  mustChangePassword: boolean("mustChangePassword").default(false).notNull(),
  /** One-time password is accepted only until this moment. */
  temporaryPasswordExpiresAt: timestamp("temporaryPasswordExpiresAt"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "manager"]).default("manager").notNull(),
  departmentId: int("departmentId"),
  managedBlocks: text("managedBlocks"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const authSessions = mysqlTable("authSessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  revokedAt: timestamp("revokedAt"),
  userAgent: varchar("userAgent", { length: 500 }),
  ipHash: varchar("ipHash", { length: 128 }),
}, table => ({
  userIdIdx: index("authSessions_userId_idx").on(table.userId),
  expiresAtIdx: index("authSessions_expiresAt_idx").on(table.expiresAt),
}));

export const passwordResetTokens = mysqlTable("passwordResetTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  userIdIdx: index("passwordResetTokens_userId_idx").on(table.userId),
  expiresAtIdx: index("passwordResetTokens_expiresAt_idx").on(table.expiresAt),
}));

export const userInvitations = mysqlTable("userInvitations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  invitedByUserId: int("invitedByUserId").notNull().references(() => users.id),
  email: varchar("email", { length: 320 }).notNull(),
  role: mysqlEnum("role", ["admin", "manager"]).notNull(),
  departmentId: int("departmentId"),
  managedBlocks: text("managedBlocks"),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  acceptedAt: timestamp("acceptedAt"),
  revokedAt: timestamp("revokedAt"),
}, table => ({
  userIdIdx: index("userInvitations_userId_idx").on(table.userId),
  expiresAtIdx: index("userInvitations_expiresAt_idx").on(table.expiresAt),
}));

export const securityAuditLog = mysqlTable("securityAuditLog", {
  id: int("id").autoincrement().primaryKey(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  actorUserId: int("actorUserId").references(() => users.id, { onDelete: "set null" }),
  targetUserId: int("targetUserId").references(() => users.id, { onDelete: "set null" }),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  actorIdx: index("securityAuditLog_actorUserId_idx").on(table.actorUserId),
  targetIdx: index("securityAuditLog_targetUserId_idx").on(table.targetUserId),
  createdAtIdx: index("securityAuditLog_createdAt_idx").on(table.createdAt),
}));

export const contracts = mysqlTable("contracts", {
  id: int("id").autoincrement().primaryKey(),
  contractNumber: varchar("contractNumber", { length: 120 }),
  contractDate: date("contractDate"),
  tenantName: varchar("tenantName", { length: 255 }).notNull(),
  tenantContact: varchar("tenantContact", { length: 255 }),
  tenantEmail: varchar("tenantEmail", { length: 320 }),
  tenantCategory: varchar("tenantCategory", { length: 120 }),
  tenantNumber: varchar("tenantNumber", { length: 120 }),
  propertyName: varchar("propertyName", { length: 255 }).notNull(),
  blockFolder: varchar("blockFolder", { length: 120 }),
  departmentId: int("departmentId"),
  unitName: varchar("unitName", { length: 120 }),
  startDate: date("startDate").notNull(),
  endDate: date("endDate").notNull(),
  terminationDate: date("terminationDate"),
  terminationReason: text("terminationReason"),
  tariffType: mysqlEnum("tariffType", ["monthly", "daily"]).notNull(),
  tariffAmount: decimal("tariffAmount", { precision: 12, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["active", "paused", "ended"]).default("active").notNull(),
  notes: text("notes"),
  archivedAt: timestamp("archivedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const documentPermissions = mysqlTable("documentPermissions", {
  id: int("id").autoincrement().primaryKey(),
  documentId: int("documentId").notNull(),
  userId: int("userId"),
  departmentId: int("departmentId"),
  canView: mysqlEnum("canView", ["yes", "no"]).default("yes").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  contractId: int("contractId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 120 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 700 }).notNull(),
  encryptionVersion: int("encryptionVersion").default(0).notNull(),
  encryptionIv: varchar("encryptionIv", { length: 64 }),
  encryptionAuthTag: varchar("encryptionAuthTag", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const contractAuditLog = mysqlTable("contractAuditLog", {
  id: int("id").autoincrement().primaryKey(),
  contractId: int("contractId").notNull(),
  actorUserId: int("actorUserId"),
  action: mysqlEnum("action", ["viewed", "created", "updated"]).notNull(),
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const accruals = mysqlTable("accruals", {
  id: int("id").autoincrement().primaryKey(),
  contractId: int("contractId"),
  period: varchar("period", { length: 7 }).notNull(),
  serviceFrom: date("serviceFrom").notNull(),
  serviceTo: date("serviceTo").notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  amountEdited: boolean("amountEdited").default(false).notNull(),
  tenantName: varchar("tenantName", { length: 255 }),
  tenantEmail: varchar("tenantEmail", { length: 320 }),
  tenantCategory: varchar("tenantCategory", { length: 120 }),
  tenantNumber: varchar("tenantNumber", { length: 120 }),
  propertyName: varchar("propertyName", { length: 255 }),
  unitName: varchar("unitName", { length: 120 }),
  tariffType: mysqlEnum("tariffType", ["monthly", "daily"]),
  tariffAmount: decimal("tariffAmount", { precision: 12, scale: 2 }),
  notes: text("notes"),
  status: mysqlEnum("status", ["draft", "invoiced"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  invoiceNumber: varchar("invoiceNumber", { length: 40 }).notNull().unique(),
  issueDate: date("issueDate").notNull(),
  period: varchar("period", { length: 7 }).notNull(),
  tenantName: varchar("tenantName", { length: 255 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 12, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["issued", "paid", "cancelled"]).default("issued").notNull(),
  paymentStatus: mysqlEnum("paymentStatus", ["issued", "partially_paid", "paid", "overdue", "disputed", "cancelled"]).default("issued").notNull(),
  dueDate: date("dueDate"),
  emailStatus: mysqlEnum("emailStatus", ["pending", "sent", "failed"]).default("pending").notNull(),
  emailSentAt: timestamp("emailSentAt"),
  emailError: varchar("emailError", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  invoiceId: int("invoiceId").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  paidAt: date("paidAt").notNull(),
  method: mysqlEnum("method", ["bank", "portal", "card", "cash", "other"]).notNull(),
  reference: varchar("reference", { length: 255 }),
  note: text("note"),
  proofFileKey: varchar("proofFileKey", { length: 500 }),
  proofFileUrl: varchar("proofFileUrl", { length: 700 }),
  status: mysqlEnum("status", ["posted", "reversed"]).default("posted").notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const paymentAudit = mysqlTable("paymentAudit", {
  id: int("id").autoincrement().primaryKey(),
  paymentId: int("paymentId"),
  invoiceId: int("invoiceId").notNull(),
  action: mysqlEnum("action", ["recorded", "reversed", "status_changed"]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  previousStatus: varchar("previousStatus", { length: 32 }),
  newStatus: varchar("newStatus", { length: 32 }),
  actorUserId: int("actorUserId"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const invoiceItems = mysqlTable("invoiceItems", {
  id: int("id").autoincrement().primaryKey(),
  invoiceId: int("invoiceId").notNull(),
  accrualId: int("accrualId").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
});

export type Department = typeof departments.$inferSelect;
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Contract = typeof contracts.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Accrual = typeof accruals.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentAudit = typeof paymentAudit.$inferSelect;
export type ContractAuditLog = typeof contractAuditLog.$inferSelect;
