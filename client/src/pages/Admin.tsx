import React, { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { APP_ROLES, PERMISSION_LABELS, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSION_MATRIX, type AppRole } from "@shared/accessControl";
import { BLOCK_FOLDER_OPTIONS } from "@shared/contractFolder";
import { parseManagedBlocks } from "@shared/managerAccess";
import {
  Building,
  Check,
  ChevronRight,
  Copy,
  FileLock2,
  History,
  KeyRound,
  Mail,
  Minus,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";

type Tab = "people" | "roles" | "journal" | "more";
type UserRow = {
  id: number;
  name: string | null;
  email: string | null;
  role: AppRole;
  accountStatus: "pending" | "active" | "disabled" | null;
  departmentId: number | null;
  managedBlocks: string | null;
  mustChangePassword: boolean;
  temporaryPasswordExpiresAt: Date | string | null;
  hasPassword: boolean;
  lastSignedIn: Date | string | null;
};
type IssuedCredentials = { name: string; email: string; temporaryPassword: string; expiresAt: Date; isNewUser: boolean };

const muted = { color: "var(--app-fg-2)" } as const;
const formatDateTime = (value: Date | string) =>
  new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const initialsOf = (user: { name: string | null; email: string | null }) =>
  (user.name || user.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

/** One plain-language status per person, so the admin sees at a glance what to do next. */
function accessState(user: UserRow) {
  if (user.accountStatus === "disabled") return { label: "Доступ отключён", tone: "muted" as const, hint: "Не может войти" };
  if (!user.hasPassword) return { label: "Пароль не выдан", tone: "danger" as const, hint: "Выдайте временный пароль" };
  if (user.mustChangePassword) {
    const expired = user.temporaryPasswordExpiresAt && new Date(user.temporaryPasswordExpiresAt).getTime() <= Date.now();
    return expired
      ? { label: "Временный пароль истёк", tone: "danger" as const, hint: "Выдайте новый временный пароль" }
      : { label: "Ждёт первого входа", tone: "warn" as const, hint: "Передайте временный пароль" };
  }
  return { label: "Работает", tone: "success" as const, hint: user.lastSignedIn ? `Входил(а) ${formatDateTime(user.lastSignedIn)}` : "" };
}
const toneStyle = {
  success: { background: "var(--app-success-soft)", color: "var(--app-success)" },
  warn: { background: "var(--app-warn-soft)", color: "var(--app-warn)" },
  danger: { background: "var(--app-danger-soft)", color: "var(--app-danger)" },
  muted: { background: "var(--app-fill)", color: "var(--app-fg-2)" },
};

const EVENT_LABELS: Record<string, string> = {
  user_created: "Добавлен сотрудник",
  temporary_password_issued: "Выдан временный пароль",
  user_role_changed: "Изменена роль",
  user_blocks_changed: "Изменены блоки",
  user_department_changed: "Изменено подразделение",
  user_activated: "Доступ включён",
  user_disabled: "Доступ отключён",
  admin_bootstrap_created: "Создан администратор (при запуске)",
  admin_bootstrap_access: "Восстановлены права администратора (при запуске)",
  admin_bootstrap_password: "Выдан пароль администратору (при запуске)",
  legacy_scans_removed: "Удалены старые сканы при переезде",
  user_invited: "Приглашение (старый способ)",
  user_invitation_resent: "Повторное приглашение (старый способ)",
  user_invitation_accepted: "Приглашение принято (старый способ)",
  user_invitation_revoked: "Приглашение отозвано (старый способ)",
};

function StatusPill({ user }: { user: UserRow }) {
  const state = accessState(user);
  return <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" style={toneStyle[state.tone]}>{state.label}</span>;
}

function RolePill({ role }: { role: AppRole }) {
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold"
      style={role === "admin" ? { background: "var(--app-accent-soft)", color: "var(--app-accent-text)" } : { background: "rgba(10,122,255,0.14)", color: "var(--app-blue-text)" }}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="ios-segment w-full" role="group" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)} className="!h-9 !text-sm">
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BlockPicker({ blocks, value, onChange }: { blocks: string[]; value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (block: string) => onChange(value.includes(block) ? value.filter(item => item !== block) : [...value, block]);
  return (
    <div className="flex flex-wrap gap-2">
      {blocks.map(block => {
        const on = value.includes(block);
        return (
          <button
            key={block}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(block)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium"
            style={on ? { background: "var(--app-active-bg)", color: "var(--app-active-fg)" } : { background: "var(--app-fill)", color: "var(--app-fg)" }}
          >
            {on && <Check className="h-3.5 w-3.5" />}
            {block}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[0.8125rem] font-semibold uppercase tracking-wide" style={muted}>{label}</p>
      {children}
      {hint && <p className="text-xs" style={muted}>{hint}</p>}
    </div>
  );
}

function CredentialsPanel({ credentials, onClose }: { credentials: IssuedCredentials; onClose: () => void }) {
  const [copied, setCopied] = useState<"password" | "message" | null>(null);
  const message = [
    `${credentials.name || "Здравствуйте"}, для вас ${credentials.isNewUser ? "создан доступ" : "сброшен пароль"} в системе УСЖП.`,
    `Адрес: ${window.location.origin}`,
    `Логин (Email): ${credentials.email}`,
    `Временный пароль: ${credentials.temporaryPassword}`,
    `Пароль одноразовый и действует до ${formatDateTime(credentials.expiresAt)}. При первом входе система попросит задать собственный пароль.`,
  ].join("\n");
  const copy = (kind: "password" | "message") => {
    void navigator.clipboard?.writeText(kind === "password" ? credentials.temporaryPassword : message).then(() => setCopied(kind));
  };
  return (
    <div role="status" className="ios-card p-5" style={{ boxShadow: "0 0 0 1.5px var(--app-accent)" }}>
      <div className="flex items-start gap-3">
        <span className="ios-tile h-9 w-9 rounded-[9px]" style={{ background: "var(--app-accent)" }}><KeyRound /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{credentials.isNewUser ? "Сотрудник добавлен — передайте ему данные для входа" : "Новый временный пароль выдан"}</p>
          <p className="mt-0.5 text-sm" style={muted}>Пароль показывается только сейчас и в базе не хранится.</p>
        </div>
        <button type="button" aria-label="Скрыть" className="rounded-full p-1.5 hover:bg-[var(--app-fill)]" onClick={onClose}><X className="h-4 w-4" /></button>
      </div>
      <dl className="mt-4 grid gap-x-4 gap-y-1.5 rounded-2xl p-4 text-sm sm:grid-cols-[150px_1fr]" style={{ background: "var(--app-surface-2)" }}>
        <dt style={muted}>Email (логин)</dt><dd className="font-medium">{credentials.email}</dd>
        <dt style={muted}>Временный пароль</dt><dd className="select-all font-mono text-lg font-semibold tracking-wider">{credentials.temporaryPassword}</dd>
        <dt style={muted}>Действует до</dt><dd>{formatDateTime(credentials.expiresAt)}</dd>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="rounded-full" onClick={() => copy("message")}>{copied === "message" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied === "message" ? "Скопировано" : "Скопировать сообщение для сотрудника"}</Button>
        <Button variant="outline" className="rounded-full" onClick={() => copy("password")}>{copied === "password" ? "Скопировано" : "Только пароль"}</Button>
      </div>
    </div>
  );
}

export function Admin() {
  const me = trpc.auth.me.useQuery();
  const users = trpc.admin.users.useQuery();
  const securityAudit = trpc.admin.securityAudit.useQuery();
  const departments = trpc.admin.departments.useQuery();
  const folders = trpc.contractFolders.list.useQuery(undefined, { retry: false });
  const contracts = trpc.contracts.list.useQuery({ includeArchived: true });
  const documents = trpc.documents.list.useQuery();

  const [tab, setTab] = useState<Tab>("people");
  const [actionError, setActionError] = useState("");
  const [credentials, setCredentials] = useState<IssuedCredentials | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", role: "manager" as AppRole, departmentId: "none", blocks: [] as string[] });
  const [departmentName, setDepartmentName] = useState("");
  const [contractId, setContractId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [permissionTarget, setPermissionTarget] = useState<"department" | "user">("department");
  const [permissionId, setPermissionId] = useState("");

  const audit = trpc.contracts.audit.useQuery({ contractId: Number(contractId) }, { enabled: Boolean(contractId) });
  const permissions = trpc.admin.documentPermissions.useQuery({ documentId: Number(documentId) }, { enabled: Boolean(documentId) });

  const people = (users.data ?? []) as UserRow[];
  const selected = people.find(user => user.id === selectedId) ?? null;
  const nameOf = (id: number | null | undefined) => {
    if (id == null) return "Система";
    const user = people.find(item => item.id === id);
    return user?.name || user?.email || `Сотрудник #${id}`;
  };
  const departmentOf = (id: number | null | undefined) => departments.data?.find(dept => dept.id === id)?.name;
  const blocks = useMemo(
    () => Array.from(new Set([...BLOCK_FOLDER_OPTIONS, ...(folders.data ?? []).map(folder => folder.name)])).sort((a, b) => a.localeCompare(b, "ru", { numeric: true })),
    [folders.data]
  );
  const needsAttention = people.filter(user => ["danger", "warn"].includes(accessState(user).tone)).length;

  const refresh = () => {
    void users.refetch();
    void securityAudit.refetch();
  };
  const onError = (error: { message: string }) => setActionError(error.message);
  const updateUser = trpc.admin.updateUser.useMutation({ onSuccess: () => { refresh(); setActionError(""); }, onError });
  const createDepartment = trpc.admin.createDepartment.useMutation({ onSuccess: () => departments.refetch(), onError });
  const setPermission = trpc.admin.setDocumentPermission.useMutation({ onSuccess: () => permissions.refetch(), onError });
  const revokePermission = trpc.admin.revokeDocumentPermission.useMutation({ onSuccess: () => permissions.refetch(), onError });
  const createUser = trpc.admin.createUser.useMutation({
    onSuccess: result => {
      refresh();
      setAdding(false);
      setDraft({ name: "", email: "", role: "manager", departmentId: "none", blocks: [] });
      setCredentials({ name: result.user.name ?? "", email: result.user.email ?? "", temporaryPassword: result.temporaryPassword, expiresAt: result.temporaryPasswordExpiresAt, isNewUser: true });
      setActionError("");
      setTab("people");
    },
    onError,
  });
  const issueTemporaryPassword = trpc.admin.issueTemporaryPassword.useMutation({
    onSuccess: (result, variables) => {
      refresh();
      const user = people.find(item => item.id === variables.userId);
      setCredentials({ name: user?.name ?? "", email: result.email ?? user?.email ?? "", temporaryPassword: result.temporaryPassword, expiresAt: result.temporaryPasswordExpiresAt, isNewUser: false });
      setSelectedId(null);
      setActionError("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError,
  });

  const saveUser = (user: UserRow, patch: { role?: AppRole; managedBlocks?: string[]; accountStatus?: "pending" | "active" | "disabled"; departmentId?: number | null }) =>
    updateUser.mutate({
      id: user.id,
      role: patch.role ?? user.role,
      managedBlocks: patch.managedBlocks ?? parseManagedBlocks(user.managedBlocks),
      accountStatus: patch.accountStatus ?? user.accountStatus ?? "pending",
      departmentId: patch.departmentId === undefined ? user.departmentId ?? null : patch.departmentId,
    });

  const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "people", label: `Сотрудники · ${people.length}`, icon: Users },
    { id: "roles", label: "Что может каждая роль", icon: ShieldCheck },
    { id: "journal", label: "Журнал", icon: History },
    { id: "more", label: "Подразделения и документы", icon: FileLock2 },
  ];

  return (
    <section className="space-y-5 pb-10">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="ios-title text-[1.875rem] leading-tight sm:text-[2.25rem]">Сотрудники и доступ</h1>
          <p className="mt-1 max-w-2xl text-[0.9375rem]" style={muted}>
            Кто работает в системе, какие блоки им открыты и что менялось. Администратор видит всё, менеджер — только свои блоки.
          </p>
        </div>
        <Button className="h-11 rounded-full px-5" onClick={() => { setAdding(true); setActionError(""); }}>
          <UserPlus className="h-4 w-4" />Добавить сотрудника
        </Button>
      </div>

      <nav aria-label="Разделы администрирования" className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(item => {
          const Icon = item.icon;
          const on = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTab(item.id)}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium"
              style={on ? { background: "var(--app-fg)", color: "var(--app-bg)" } : { background: "var(--app-surface)", color: "var(--app-fg)", boxShadow: "var(--app-shadow)" }}
            >
              <Icon className="h-4 w-4" />{item.label}
            </button>
          );
        })}
      </nav>

      {actionError && <p role="alert" className="rounded-2xl px-4 py-3 text-sm" style={toneStyle.danger}>{actionError}</p>}
      {credentials && <CredentialsPanel credentials={credentials} onClose={() => setCredentials(null)} />}

      {tab === "people" && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { n: "1", title: "Добавьте сотрудника", text: "Имя, email, роль и блоки" },
              { n: "2", title: "Передайте пароль", text: "Система выдаст временный пароль" },
              { n: "3", title: "Сотрудник входит", text: "И сразу задаёт свой пароль" },
            ].map(step => (
              <div key={step.n} className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: "var(--app-surface)", boxShadow: "var(--app-shadow)" }}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: "var(--app-accent-soft)", color: "var(--app-accent-text)" }}>{step.n}</span>
                <span className="min-w-0"><span className="block text-sm font-semibold">{step.title}</span><span className="block text-xs" style={muted}>{step.text}</span></span>
              </div>
            ))}
          </div>

          {needsAttention > 0 && (
            <p className="rounded-2xl px-4 py-3 text-sm" style={toneStyle.warn}>
              {needsAttention === 1 ? "1 сотрудник ещё не вошёл в систему" : `${needsAttention} сотрудника(ов) ещё не вошли в систему`} — откройте карточку и выдайте или передайте временный пароль.
            </p>
          )}

          <div className="ios-group">
            {people.map((user, index) => (
              <button
                key={user.id}
                type="button"
                onClick={() => setSelectedId(user.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--app-fill)]"
                style={index ? { boxShadow: "inset 0 1px 0 var(--app-sep)" } : undefined}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: "var(--app-accent-soft)", color: "var(--app-accent-text)" }}>{initialsOf(user)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{user.name || user.email}{user.id === me.data?.id && <span className="font-normal" style={muted}> · это вы</span>}</span>
                  <span className="block truncate text-[0.8125rem]" style={muted}>
                    {user.email}
                    {user.role === "manager" && ` · ${parseManagedBlocks(user.managedBlocks).join(", ") || "блоки не назначены"}`}
                  </span>
                </span>
                <span className="hidden flex-wrap justify-end gap-1.5 sm:flex"><RolePill role={user.role} /><StatusPill user={user} /></span>
                <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--app-fg-3)" }} />
              </button>
            ))}
            {!people.length && <p className="p-5 text-sm" style={muted}>Сотрудников пока нет.</p>}
          </div>
        </>
      )}

      {tab === "roles" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {APP_ROLES.map(role => (
            <div key={role} className="ios-card p-5">
              <div className="flex items-center gap-3">
                <span className="ios-tile h-10 w-10 rounded-[10px]" style={{ background: role === "admin" ? "var(--app-accent)" : "#0a7aff" }}>{role === "admin" ? <ShieldCheck /> : <Users />}</span>
                <div><p className="text-lg font-semibold">{ROLE_LABELS[role]}</p><p className="text-sm" style={muted}>{ROLE_DESCRIPTIONS[role]}</p></div>
              </div>
              <ul className="mt-4 space-y-1">
                {Object.entries(PERMISSION_LABELS).map(([permission, label]) => {
                  const allowed = ROLE_PERMISSION_MATRIX[permission as keyof typeof ROLE_PERMISSION_MATRIX].includes(role);
                  return (
                    <li key={permission} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={allowed ? toneStyle.success : toneStyle.muted}>{allowed ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}</span>
                      <span style={allowed ? undefined : muted}>{label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="text-sm lg:col-span-2" style={muted}>Ограничения проверяются на сервере: менеджер не откроет чужой блок, даже если узнает прямую ссылку.</p>
        </div>
      )}

      {tab === "journal" && (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="ios-group">
            <div className="px-5 pb-2 pt-4"><h2 className="ios-widget-label">Сотрудники и доступ</h2><p className="text-xs" style={muted}>Последние 500 событий</p></div>
            {(securityAudit.data ?? []).map(entry => (
              <div key={entry.id} className="flex gap-3 px-5 py-3" style={{ boxShadow: "inset 0 1px 0 var(--app-sep)" }}>
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--app-fill)" }}><History className="h-4 w-4" /></span>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">{EVENT_LABELS[entry.eventType] ?? entry.eventType}</p>
                  <p style={muted}>
                    {nameOf(entry.actorUserId)}
                    {entry.targetUserId != null && entry.targetUserId !== entry.actorUserId && <> → {nameOf(entry.targetUserId)}</>}
                    {" · "}{formatDateTime(entry.createdAt)}
                  </p>
                </div>
              </div>
            ))}
            {!securityAudit.data?.length && <p className="px-5 pb-5 text-sm" style={muted}>Событий пока нет.</p>}
          </div>
          <div className="ios-card space-y-3 p-5 self-start">
            <h2 className="ios-widget-label">История договора</h2>
            <p className="text-sm" style={muted}>Кто и когда открывал, создавал или менял договор.</p>
            <select value={contractId} onChange={event => setContractId(event.target.value)} className="h-10 w-full rounded-[10px] border-0 bg-[var(--app-fill)] px-3 text-[0.9375rem] outline-none">
              <option value="">Выберите договор</option>
              {(contracts.data ?? []).map(contract => <option key={contract.id} value={String(contract.id)}>{contract.contractNumber ? `№ ${contract.contractNumber} · ` : ""}{contract.tenantName}</option>)}
            </select>
            <div className="space-y-2">
              {(audit.data ?? []).map(entry => (
                <div key={entry.id} className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--app-surface-2)" }}>
                  <p className="font-medium">{entry.action === "viewed" ? "Просмотр" : entry.action === "created" ? "Создание" : "Изменение"}</p>
                  <p className="text-xs" style={muted}>{nameOf(entry.actorUserId)} · {formatDateTime(entry.createdAt)}</p>
                  {entry.details && <p className="mt-1 text-xs" style={muted}>{entry.details}</p>}
                </div>
              ))}
              {contractId && !audit.data?.length && <p className="text-sm" style={muted}>Записей пока нет.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "more" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="ios-card space-y-4 p-5 self-start">
            <div className="flex items-center gap-3"><span className="ios-tile h-9 w-9 rounded-[9px]" style={{ background: "#636366" }}><Building /></span><div><h2 className="font-semibold">Подразделения</h2><p className="text-sm" style={muted}>Используются в карточке сотрудника и в правах на документы.</p></div></div>
            <div className="flex flex-wrap gap-2">
              {(departments.data ?? []).map(dept => <span key={dept.id} className="rounded-full px-3 py-1.5 text-sm" style={{ background: "var(--app-fill)" }}>{dept.name}</span>)}
              {!departments.data?.length && <span className="text-sm" style={muted}>Пока нет подразделений.</span>}
            </div>
            <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (departmentName.trim()) { createDepartment.mutate({ name: departmentName.trim() }); setDepartmentName(""); } }}>
              <Input value={departmentName} onChange={event => setDepartmentName(event.target.value)} placeholder="Название подразделения" className="h-10" />
              <Button type="submit" className="h-10 rounded-full px-4">Добавить</Button>
            </form>
          </div>
          <div className="ios-card space-y-4 p-5">
            <div className="flex items-center gap-3"><span className="ios-tile h-9 w-9 rounded-[9px]" style={{ background: "#5856d6" }}><FileLock2 /></span><div><h2 className="font-semibold">Доступ к отдельному скану</h2><p className="text-sm" style={muted}>Исключение из общих правил: открыть или закрыть один документ.</p></div></div>
            <select value={documentId} onChange={event => setDocumentId(event.target.value)} className="h-10 w-full rounded-[10px] border-0 bg-[var(--app-fill)] px-3 text-[0.9375rem] outline-none">
              <option value="">Выберите документ</option>
              {(documents.data ?? []).map(doc => {
                const contract = contracts.data?.find(item => item.id === doc.contractId);
                return <option key={doc.id} value={String(doc.id)}>{doc.fileName} · {contract?.tenantName ?? `договор #${doc.contractId}`}</option>;
              })}
            </select>
            <Segmented label="Для кого" value={permissionTarget} onChange={value => { setPermissionTarget(value); setPermissionId(""); }} options={[{ value: "department", label: "Подразделение" }, { value: "user", label: "Сотрудник" }]} />
            <select value={permissionId} onChange={event => setPermissionId(event.target.value)} className="h-10 w-full rounded-[10px] border-0 bg-[var(--app-fill)] px-3 text-[0.9375rem] outline-none">
              <option value="">{permissionTarget === "user" ? "Выберите сотрудника" : "Выберите подразделение"}</option>
              {permissionTarget === "user"
                ? people.map(user => <option key={user.id} value={String(user.id)}>{user.name || user.email}</option>)
                : (departments.data ?? []).map(dept => <option key={dept.id} value={String(dept.id)}>{dept.name}</option>)}
            </select>
            <div className="flex flex-wrap gap-2">
              {(["yes", "no"] as const).map(canView => (
                <Button
                  key={canView}
                  variant={canView === "yes" ? "default" : "outline"}
                  className="rounded-full"
                  disabled={!documentId || !permissionId}
                  onClick={() => setPermission.mutate({ documentId: Number(documentId), userId: permissionTarget === "user" ? Number(permissionId) : null, departmentId: permissionTarget === "department" ? Number(permissionId) : null, canView })}
                >
                  {canView === "yes" ? "Разрешить просмотр" : "Запретить просмотр"}
                </Button>
              ))}
            </div>
            {permissions.data?.length ? (
              <div className="space-y-2 pt-1">
                <p className="text-[0.8125rem] font-semibold uppercase tracking-wide" style={muted}>Правила для документа</p>
                {permissions.data.map(rule => (
                  <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm" style={{ background: "var(--app-surface-2)" }}>
                    <span className="flex-1">{rule.userId ? nameOf(rule.userId) : departmentOf(rule.departmentId) ?? "Подразделение"} — <b style={{ color: rule.canView === "yes" ? "var(--app-success)" : "var(--app-danger)" }}>{rule.canView === "yes" ? "разрешено" : "запрещено"}</b></span>
                    <Button size="sm" variant="ghost" className="rounded-full" onClick={() => revokePermission.mutate({ id: rule.id })}>Убрать</Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="px-6 pt-6">
            <SheetTitle className="text-xl">Новый сотрудник</SheetTitle>
            <SheetDescription>После сохранения появится временный пароль — передайте его сотруднику вместе с email.</SheetDescription>
          </SheetHeader>
          <form
            className="space-y-6 px-6 pb-8 pt-4"
            onSubmit={event => {
              event.preventDefault();
              createUser.mutate({ name: draft.name.trim(), email: draft.email.trim(), role: draft.role, departmentId: draft.departmentId === "none" ? null : Number(draft.departmentId), managedBlocks: draft.role === "admin" ? [] : draft.blocks });
            }}
          >
            <div className="ios-group">
              <input className="h-12 w-full border-0 bg-transparent px-4 text-[1rem] outline-none" placeholder="Имя и фамилия" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required aria-label="Имя и фамилия" />
              <div className="ml-4 h-px" style={{ background: "var(--app-sep)" }} />
              <label className="flex items-center gap-2 pr-4">
                <input className="h-12 w-full border-0 bg-transparent px-4 text-[1rem] outline-none" type="email" placeholder="Рабочий email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} required aria-label="Рабочий email" />
                <Mail className="h-4 w-4 shrink-0" style={{ color: "var(--app-fg-3)" }} />
              </label>
            </div>
            <Field label="Роль" hint={ROLE_DESCRIPTIONS[draft.role]}>
              <Segmented label="Роль" value={draft.role} onChange={role => setDraft({ ...draft, role })} options={APP_ROLES.map(role => ({ value: role, label: ROLE_LABELS[role] }))} />
            </Field>
            {draft.role === "manager" && (
              <Field label="Блоки" hint={draft.blocks.length ? `Выбрано: ${draft.blocks.length}` : "Без блоков менеджер не увидит ни одного договора"}>
                <BlockPicker blocks={blocks} value={draft.blocks} onChange={next => setDraft({ ...draft, blocks: next })} />
              </Field>
            )}
            <Field label="Подразделение">
              <select value={draft.departmentId} onChange={event => setDraft({ ...draft, departmentId: event.target.value })} className="h-11 w-full rounded-[10px] border-0 bg-[var(--app-fill)] px-3 text-[0.9375rem] outline-none">
                <option value="none">Без подразделения</option>
                {(departments.data ?? []).map(dept => <option key={dept.id} value={String(dept.id)}>{dept.name}</option>)}
              </select>
            </Field>
            {actionError && <p role="alert" className="rounded-xl px-3 py-2 text-sm" style={toneStyle.danger}>{actionError}</p>}
            <Button type="submit" className="h-12 w-full rounded-full text-[1rem]" disabled={createUser.isPending || !draft.name.trim() || !draft.email.trim()}>
              <KeyRound className="h-4 w-4" />{createUser.isPending ? "Создаём…" : "Добавить и получить пароль"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(selected)} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
          {selected && (() => {
            const isSelf = selected.id === me.data?.id;
            const state = accessState(selected);
            const managed = parseManagedBlocks(selected.managedBlocks);
            return (
              <>
                <SheetHeader className="items-center px-6 pb-2 pt-8 text-center">
                  <span className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold" style={{ background: "var(--app-accent-soft)", color: "var(--app-accent-text)" }}>{initialsOf(selected)}</span>
                  <SheetTitle className="mt-2 text-xl">{selected.name || selected.email}</SheetTitle>
                  <SheetDescription>{selected.email}</SheetDescription>
                  <div className="mt-1 flex gap-1.5"><RolePill role={selected.role} /><StatusPill user={selected} /></div>
                  {state.hint && <p className="text-xs" style={muted}>{state.hint}</p>}
                </SheetHeader>
                <div className="space-y-6 px-6 pb-8 pt-4">
                  {!isSelf && selected.accountStatus !== "disabled" && (
                    <Button variant={state.tone === "success" ? "outline" : "default"} className="h-11 w-full rounded-full" disabled={issueTemporaryPassword.isPending} onClick={() => {
                      if (window.confirm(`Выдать новый временный пароль для ${selected.email || selected.name}? Текущий пароль перестанет работать.`)) issueTemporaryPassword.mutate({ userId: selected.id });
                    }}>
                      <KeyRound className="h-4 w-4" />{selected.hasPassword ? "Сбросить пароль и выдать временный" : "Выдать временный пароль"}
                    </Button>
                  )}
                  <Field label="Роль" hint={isSelf ? "Свою роль изменить нельзя" : ROLE_DESCRIPTIONS[selected.role]}>
                    {isSelf ? <RolePill role={selected.role} /> : <Segmented label="Роль" value={selected.role} onChange={role => saveUser(selected, { role })} options={APP_ROLES.map(role => ({ value: role, label: ROLE_LABELS[role] }))} />}
                  </Field>
                  {selected.role === "manager" && (
                    <Field label="Блоки" hint={managed.length ? "Изменения сохраняются сразу" : "Блоки не назначены — менеджер не видит договоров"}>
                      <BlockPicker blocks={blocks} value={managed} onChange={next => saveUser(selected, { managedBlocks: next })} />
                    </Field>
                  )}
                  <Field label="Подразделение">
                    <select value={selected.departmentId ? String(selected.departmentId) : "none"} onChange={event => saveUser(selected, { departmentId: event.target.value === "none" ? null : Number(event.target.value) })} className="h-11 w-full rounded-[10px] border-0 bg-[var(--app-fill)] px-3 text-[0.9375rem] outline-none">
                      <option value="none">Без подразделения</option>
                      {(departments.data ?? []).map(dept => <option key={dept.id} value={String(dept.id)}>{dept.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Доступ" hint={isSelf ? "Свой доступ отключить нельзя" : "Отключённый сотрудник не сможет войти, данные сохранятся"}>
                    <Segmented label="Доступ" value={selected.accountStatus === "disabled" ? "disabled" : "active"} onChange={value => !isSelf && saveUser(selected, { accountStatus: value })} options={[{ value: "active", label: "Включён" }, { value: "disabled", label: "Отключён" }]} />
                  </Field>
                  {actionError && <p role="alert" className="rounded-xl px-3 py-2 text-sm" style={toneStyle.danger}>{actionError}</p>}
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </section>
  );
}
