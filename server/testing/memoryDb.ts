// In-memory stand-in for ./db used by the security regression tests.
// Two blocks, two managers, and one contract/accrual/invoice/payment/document per block —
// enough to try every "swap the ID for someone else's" attack through the real routers.
import { createHash } from "node:crypto";

type Row = Record<string, any>;
const clone = <T>(value: T): T => structuredClone(value);
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function createMemoryDb() {
  const state = {
    users: [] as Row[],
    sessions: [] as Row[],
    contracts: [] as Row[],
    accruals: [] as Row[],
    invoices: [] as Row[],
    invoiceItems: [] as Row[],
    payments: [] as Row[],
    paymentAudit: [] as Row[],
    documents: [] as Row[],
    documentPermissions: [] as Row[],
    contractAudit: [] as Row[],
  };
  let nextId = 10_000;

  function seed() {
    Object.values(state).forEach(list => list.splice(0));
    state.users.push(
      {
        id: 1,
        name: "Admin",
        email: "admin@nu.edu.kz",
        emailNormalized: "admin@nu.edu.kz",
        role: "admin",
        managedBlocks: null,
        departmentId: null,
        accountStatus: "active",
        passwordHash: null,
        mustChangePassword: false,
      },
      {
        id: 2,
        name: "Alice",
        email: "alice@nu.edu.kz",
        emailNormalized: "alice@nu.edu.kz",
        role: "manager",
        managedBlocks: JSON.stringify(["Блок А1"]),
        departmentId: 1,
        accountStatus: "active",
        passwordHash: null,
        mustChangePassword: false,
      },
      {
        id: 3,
        name: "Bob",
        email: "bob@nu.edu.kz",
        emailNormalized: "bob@nu.edu.kz",
        role: "manager",
        managedBlocks: JSON.stringify(["Блок А2"]),
        departmentId: 1,
        accountStatus: "active",
        passwordHash: null,
        mustChangePassword: false,
      }
    );
    state.contracts.push(
      {
        id: 1,
        contractNumber: "A1-001",
        contractDate: d("2026-01-10"),
        tenantName: "Иван Иванов",
        tenantEmail: "ivan@example.com",
        tenantCategory: "Сотрудник",
        tenantNumber: "1",
        propertyName: "Блок 38",
        unitName: "101",
        blockFolder: "Блок А1",
        startDate: d("2026-01-01"),
        endDate: d("2026-12-31"),
        tariffType: "monthly",
        tariffAmount: "100000.00",
        status: "active",
        departmentId: 1,
        archivedAt: null,
        updatedAt: d("2026-01-10"),
      },
      {
        id: 2,
        contractNumber: "A2-001",
        contractDate: d("2026-01-10"),
        tenantName: "Пётр Петров",
        tenantEmail: "petr@example.com",
        tenantCategory: "Сотрудник",
        tenantNumber: "2",
        propertyName: "Блок 44",
        unitName: "202",
        blockFolder: "Блок А2",
        startDate: d("2026-01-01"),
        endDate: d("2026-12-31"),
        tariffType: "monthly",
        tariffAmount: "120000.00",
        status: "active",
        departmentId: 1,
        archivedAt: null,
        updatedAt: d("2026-01-10"),
      }
    );
    const accrual = (
      id: number,
      contractId: number,
      status: string,
      amount: string
    ) => ({
      id,
      contractId,
      period: "2026-08",
      serviceFrom: d("2026-08-01"),
      serviceTo: d("2026-08-31"),
      quantity: "1.00",
      amount,
      amountEdited: false,
      tenantName: contractId === 1 ? "Иван Иванов" : "Пётр Петров",
      tenantEmail: null,
      tenantCategory: "Сотрудник",
      tenantNumber: String(contractId),
      propertyName: contractId === 1 ? "Блок 38" : "Блок 44",
      unitName: null,
      tariffType: "monthly",
      tariffAmount: amount,
      notes: null,
      status,
      createdAt: d("2026-08-01"),
    });
    state.accruals.push(
      accrual(11, 1, "draft", "100000.00"),
      accrual(12, 1, "invoiced", "100000.00"),
      accrual(21, 2, "draft", "120000.00"),
      accrual(22, 2, "invoiced", "120000.00")
    );
    const invoice = (id: number, tenantName: string, total: string) => ({
      id,
      invoiceNumber: `INV-2026-${id}`,
      issueDate: d("2026-08-01"),
      period: "2026-08",
      tenantName,
      totalAmount: total,
      status: "issued",
      paymentStatus: "issued",
      dueDate: null,
      emailStatus: "pending",
      emailSentAt: null,
      emailError: null,
      createdAt: d("2026-08-01"),
    });
    state.invoices.push(
      invoice(101, "Иван Иванов", "100000.00"),
      invoice(201, "Пётр Петров", "120000.00")
    );
    state.invoiceItems.push(
      {
        id: 1,
        invoiceId: 101,
        accrualId: 12,
        description: "Август",
        amount: "100000.00",
      },
      {
        id: 2,
        invoiceId: 201,
        accrualId: 22,
        description: "Август",
        amount: "120000.00",
      }
    );
    state.payments.push(
      {
        id: 1001,
        invoiceId: 101,
        amount: "10000.00",
        paidAt: d("2026-08-05"),
        method: "bank",
        reference: "TX-A",
        note: null,
        status: "posted",
        createdBy: 2,
      },
      {
        id: 2001,
        invoiceId: 201,
        amount: "20000.00",
        paidAt: d("2026-08-05"),
        method: "bank",
        reference: "TX-B",
        note: null,
        status: "posted",
        createdBy: 3,
      }
    );
    state.documents.push(
      {
        id: 501,
        contractId: 1,
        fileName: "a1.pdf",
        mimeType: "application/pdf",
        fileKey: "2/contracts/1/a1.enc",
        fileUrl: "/files/2/contracts/1/a1.enc",
        encryptionVersion: 0,
        encryptionIv: null,
        encryptionAuthTag: null,
        createdAt: d("2026-08-01"),
      },
      {
        id: 502,
        contractId: 2,
        fileName: "a2.pdf",
        mimeType: "application/pdf",
        fileKey: "3/contracts/2/a2.enc",
        fileUrl: "/files/3/contracts/2/a2.enc",
        encryptionVersion: 0,
        encryptionIv: null,
        encryptionAuthTag: null,
        createdAt: d("2026-08-01"),
      }
    );
  }
  seed();

  class AccrualsAlreadyInvoicedError extends Error {
    constructor() {
      super("Часть начислений уже включена в другой счёт — обновите страницу");
      this.name = "AccrualsAlreadyInvoicedError";
    }
  }

  const paidOf = (invoiceId: number) =>
    state.payments
      .filter(p => p.invoiceId === invoiceId && p.status === "posted")
      .reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);

  const api = {
    state,
    seed,
    AccrualsAlreadyInvoicedError,
    getDb: async () => null,
    // users & sessions
    getUserById: async (id: number) =>
      clone(state.users.find(u => u.id === id)),
    getUserByEmailNormalized: async (email: string) =>
      clone(state.users.find(u => u.emailNormalized === email)),
    updateUserLocalAuth: async (id: number, patch: Row) => {
      Object.assign(state.users.find(u => u.id === id) ?? {}, patch);
      return clone(state.users.find(u => u.id === id));
    },
    createAuthSession: async (input: Row) => {
      const row = {
        id: ++nextId,
        revokedAt: null,
        lastSeenAt: new Date(),
        ...input,
      };
      state.sessions.push(row);
      return clone(row);
    },
    getAuthSessionUser: async (hash: string) => {
      const session = state.sessions.find(s => s.tokenHash === hash);
      const user = session && state.users.find(u => u.id === session.userId);
      return session && user
        ? { session: clone(session), user: clone(user) }
        : undefined;
    },
    updateAuthSessionSeen: async () => undefined,
    revokeAuthSession: async (hash: string) => {
      state.sessions
        .filter(s => s.tokenHash === hash)
        .forEach(s => (s.revokedAt = new Date()));
    },
    revokeUserSessions: async (userId: number) => {
      state.sessions
        .filter(s => s.userId === userId)
        .forEach(s => (s.revokedAt = new Date()));
    },
    // contracts
    getContract: async (id: number) =>
      clone(state.contracts.find(c => c.id === id)),
    listContracts: async () => clone(state.contracts),
    listContractAudit: async (contractId: number) =>
      clone(state.contractAudit.filter(a => a.contractId === contractId)),
    createContractAudit: async (input: Row) => {
      state.contractAudit.push({ id: ++nextId, ...input });
    },
    listContractFolders: async () => [],
    // accruals
    getAccrual: async (id: number) =>
      clone(state.accruals.find(a => a.id === id)),
    listAccruals: async (period?: string) =>
      clone(state.accruals.filter(a => !period || a.period === period)),
    listAccrualsByIds: async (ids: number[]) =>
      clone(state.accruals.filter(a => ids.includes(a.id))),
    createAccrual: async (input: Row) => {
      const row = { id: ++nextId, ...input };
      state.accruals.push(row);
      return clone(row);
    },
    updateAccrual: async (id: number, patch: Row) => {
      Object.assign(state.accruals.find(a => a.id === id) ?? {}, patch);
      return clone(state.accruals.find(a => a.id === id));
    },
    updateDraftAccrual: async (id: number, patch: Row) => {
      const row = state.accruals.find(a => a.id === id && a.status === "draft");
      if (!row) throw new Error("Начисление в счёте нельзя изменять");
      Object.assign(row, patch);
      return clone(row);
    },
    deleteAccrual: async (id: number) => {
      const index = state.accruals.findIndex(
        a => a.id === id && a.status === "draft"
      );
      if (index < 0) throw new Error("Начисление в счёте нельзя удалять");
      return clone(state.accruals.splice(index, 1)[0]);
    },
    // invoices & payments
    listInvoices: async () => clone(state.invoices),
    getInvoice: async (id: number) =>
      clone(state.invoices.find(i => i.id === id)),
    getInvoiceItems: async (invoiceId: number) =>
      clone(state.invoiceItems.filter(i => i.invoiceId === invoiceId)),
    listAllInvoiceItems: async () => clone(state.invoiceItems),
    createInvoice: async (input: Row, items: Row[]) => {
      const ids = items.map(item => item.accrualId);
      const rows = state.accruals.filter(a => ids.includes(a.id));
      if (rows.length !== ids.length || rows.some(a => a.status !== "draft"))
        throw new AccrualsAlreadyInvoicedError();
      const invoice = {
        id: ++nextId,
        status: "issued",
        paymentStatus: "issued",
        emailStatus: "pending",
        ...input,
      };
      state.invoices.push(invoice);
      items.forEach(item =>
        state.invoiceItems.push({
          id: ++nextId,
          ...item,
          invoiceId: invoice.id,
        })
      );
      rows.forEach(row => (row.status = "invoiced"));
      return clone(invoice);
    },
    updateInvoiceEmail: async (id: number, patch: Row) => {
      Object.assign(state.invoices.find(i => i.id === id) ?? {}, patch);
      return clone(state.invoices.find(i => i.id === id));
    },
    listPayments: async (invoiceId?: number) =>
      clone(
        state.payments.filter(p => !invoiceId || p.invoiceId === invoiceId)
      ),
    getPayment: async (id: number) =>
      clone(state.payments.find(p => p.id === id)),
    findPaymentByReference: async (invoiceId: number, reference: string) =>
      clone(
        state.payments.find(
          p => p.invoiceId === invoiceId && p.reference === reference
        )
      ),
    listPaymentAudit: async (invoiceId: number) =>
      clone(state.paymentAudit.filter(a => a.invoiceId === invoiceId)),
    recordPayment: async (input: Row, actorUserId: number) => {
      const invoice = state.invoices.find(i => i.id === input.invoiceId);
      if (!invoice) throw new Error("Счёт не найден");
      const cents = Math.round(Number(input.amount) * 100);
      if (
        cents >
        Math.round(Number(invoice.totalAmount) * 100) - paidOf(invoice.id)
      )
        throw new Error("Сумма платежа превышает остаток по счёту");
      const row = {
        id: ++nextId,
        ...input,
        status: "posted",
        createdBy: actorUserId,
      };
      state.payments.push(row);
      return clone(row);
    },
    reversePayment: async (paymentId: number) => {
      const payment = state.payments.find(p => p.id === paymentId);
      if (!payment || payment.status === "reversed")
        throw new Error("Платёж уже отменён");
      payment.status = "reversed";
      return { paidAmount: paidOf(payment.invoiceId) / 100 };
    },
    recalculateInvoicePaymentStatus: async (invoiceId: number) => ({
      invoice: clone(state.invoices.find(i => i.id === invoiceId)),
      paidAmount: paidOf(invoiceId) / 100,
    }),
    updateInvoicePaymentStatus: async (id: number, paymentStatus: string) => {
      Object.assign(state.invoices.find(i => i.id === id) ?? {}, {
        paymentStatus,
      });
      return clone(state.invoices.find(i => i.id === id));
    },
    // documents
    getDocument: async (id: number) =>
      clone(state.documents.find(doc => doc.id === id)),
    listDocuments: async (contractId?: number) =>
      clone(
        state.documents.filter(
          doc => !contractId || doc.contractId === contractId
        )
      ),
    listDocumentPermissions: async (documentId?: number) =>
      clone(
        state.documentPermissions.filter(
          p => !documentId || p.documentId === documentId
        )
      ),
    deleteDocument: async (id: number) => {
      const index = state.documents.findIndex(doc => doc.id === id);
      return clone(state.documents.splice(index, 1)[0]);
    },
    createDocument: async (input: Row) => {
      const row = { id: ++nextId, ...input };
      state.documents.push(row);
      return clone(row);
    },
  };
  return api;
}
