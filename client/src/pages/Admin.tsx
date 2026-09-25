import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  APP_ROLES,
  PERMISSION_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSION_MATRIX,
  type AppRole,
} from "@shared/accessControl";
import { BLOCK_FOLDER_OPTIONS } from "@shared/contractFolder";
import { parseManagedBlocks } from "@shared/managerAccess";
import { Check, Copy, KeyRound } from "lucide-react";

type IssuedCredentials = {
  name: string;
  email: string;
  temporaryPassword: string;
  expiresAt: Date;
  isNewUser: boolean;
};

const formatDateTime = (value: Date | string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

const credentialsMessage = (credentials: IssuedCredentials) =>
  [
    `${credentials.name || "Здравствуйте"}, для вас ${credentials.isNewUser ? "создан доступ" : "сброшен пароль"} в системе УСЖП.`,
    `Адрес: ${window.location.origin}`,
    `Логин (Email): ${credentials.email}`,
    `Временный пароль: ${credentials.temporaryPassword}`,
    `Пароль одноразовый и действует до ${formatDateTime(credentials.expiresAt)}. При первом входе система попросит задать собственный пароль.`,
  ].join("\n");

function CredentialsPanel({
  credentials,
  onClose,
}: {
  credentials: IssuedCredentials;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"password" | "message" | null>(null);
  const copy = (kind: "password" | "message") => {
    const text =
      kind === "password"
        ? credentials.temporaryPassword
        : credentialsMessage(credentials);
    void navigator.clipboard?.writeText(text).then(() => setCopied(kind));
  };
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <p className="flex items-center gap-2 font-semibold">
        <KeyRound className="h-4 w-4" />
        {credentials.isNewUser
          ? "Сотрудник добавлен. Передайте ему данные для входа:"
          : "Новый временный пароль выдан:"}
      </p>
      <dl className="mt-3 grid gap-1 sm:grid-cols-[140px_1fr]">
        <dt className="text-amber-800">Email (логин)</dt>
        <dd className="font-medium">{credentials.email}</dd>
        <dt className="text-amber-800">Временный пароль</dt>
        <dd className="select-all font-mono text-base font-semibold tracking-wider">
          {credentials.temporaryPassword}
        </dd>
        <dt className="text-amber-800">Действует до</dt>
        <dd>{formatDateTime(credentials.expiresAt)}</dd>
      </dl>
      <p className="mt-3 text-xs text-amber-800">
        Пароль показывается только один раз и в базе не хранится. При первом
        входе сотрудник обязан заменить его на собственный.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => copy("message")}>
          {copied === "message" ? (
            <Check className="mr-1.5 h-4 w-4" />
          ) : (
            <Copy className="mr-1.5 h-4 w-4" />
          )}
          {copied === "message" ? "Скопировано" : "Скопировать сообщение"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => copy("password")}>
          {copied === "password" ? "Скопировано" : "Скопировать пароль"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Скрыть
        </Button>
      </div>
    </div>
  );
}

const accountStatusLabels: Record<string, string> = {
  pending: "Ожидает активации",
  active: "Активен",
  disabled: "Отключён",
};

export function Admin() {
  const me = trpc.auth.me.useQuery();
  const users = trpc.admin.users.useQuery();
  const securityAudit = trpc.admin.securityAudit.useQuery();
  const departments = trpc.admin.departments.useQuery();
  const contracts = trpc.contracts.list.useQuery({ includeArchived: true });
  const documents = trpc.documents.list.useQuery();
  const [departmentName, setDepartmentName] = useState("");
  const [contractId, setContractId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [permissionTarget, setPermissionTarget] = useState("department");
  const [permissionId, setPermissionId] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("manager");
  const [inviteDepartmentId, setInviteDepartmentId] = useState("none");
  const [inviteBlocks, setInviteBlocks] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<IssuedCredentials | null>(
    null
  );
  const [actionError, setActionError] = useState("");
  const audit = trpc.contracts.audit.useQuery(
    { contractId: Number(contractId) },
    { enabled: Boolean(contractId) }
  );
  const permissions = trpc.admin.documentPermissions.useQuery(
    { documentId: Number(documentId) },
    { enabled: Boolean(documentId) }
  );
  const refreshUsers = () => {
    void users.refetch();
    void securityAudit.refetch();
  };
  const updateUser = trpc.admin.updateUser.useMutation({
    onSuccess: refreshUsers,
    onError: error => setActionError(error.message),
  });
  const createDepartment = trpc.admin.createDepartment.useMutation({
    onSuccess: () => departments.refetch(),
    onError: error => setActionError(error.message),
  });
  const setPermission = trpc.admin.setDocumentPermission.useMutation({
    onSuccess: () => permissions.refetch(),
    onError: error => setActionError(error.message),
  });
  const revokePermission = trpc.admin.revokeDocumentPermission.useMutation({
    onSuccess: () => permissions.refetch(),
    onError: error => setActionError(error.message),
  });
  const createUser = trpc.admin.createUser.useMutation({
    onSuccess: result => {
      refreshUsers();
      setInviteName("");
      setInviteEmail("");
      setInviteBlocks([]);
      setCredentials({
        name: result.user.name ?? "",
        email: result.user.email ?? "",
        temporaryPassword: result.temporaryPassword,
        expiresAt: result.temporaryPasswordExpiresAt,
        isNewUser: true,
      });
      setActionError("");
    },
    onError: error => setActionError(error.message),
  });
  const issueTemporaryPassword = trpc.admin.issueTemporaryPassword.useMutation(
    { onError: error => setActionError(error.message) }
  );
  const issuePasswordFor = (user: NonNullable<typeof users.data>[number]) => {
    if (
      !window.confirm(
        `Выдать новый временный пароль для ${user.email || user.name}? Текущий пароль перестанет работать, активные сессии будут завершены.`
      )
    )
      return;
    issueTemporaryPassword.mutate(
      { userId: user.id },
      {
        onSuccess: result => {
          refreshUsers();
          setActionError("");
          setCredentials({
            name: user.name ?? "",
            email: result.email ?? user.email ?? "",
            temporaryPassword: result.temporaryPassword,
            expiresAt: result.temporaryPasswordExpiresAt,
            isNewUser: false,
          });
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
      }
    );
  };
  const saveUser = (
    user: NonNullable<typeof users.data>[number],
    patch: {
      role?: AppRole;
      managedBlocks?: string[];
      accountStatus?: "pending" | "active" | "disabled";
      departmentId?: number | null;
    }
  ) =>
    updateUser.mutate({
      id: user.id,
      role: patch.role ?? user.role,
      managedBlocks:
        patch.managedBlocks ?? parseManagedBlocks(user.managedBlocks),
      accountStatus: patch.accountStatus ?? user.accountStatus ?? "pending",
      departmentId:
        patch.departmentId === undefined
          ? (user.departmentId ?? null)
          : patch.departmentId,
    });

  return (
    <section className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[#9a7633]">
          Администрирование
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-[#3f3f3f]">
          Пользователи и доступ по блокам
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          Администратор имеет полный доступ. Менеджер видит, загружает и
          изменяет договоры только в назначенных папках блоков.
        </p>
        {actionError && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {actionError}
          </p>
        )}
        {credentials && (
          <div className="mt-4 max-w-2xl">
            <CredentialsPanel
              credentials={credentials}
              onClose={() => setCredentials(null)}
            />
          </div>
        )}
      </div>
      <div className="border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Доступные роли</h2>
            <p className="mt-1 text-sm text-slate-500">
              В приложении используются только две роли. Ограничения проверяются
              на сервере.
            </p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            Защищено backend-проверками
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Право</th>
                {APP_ROLES.map(role => (
                  <th key={role} className="px-3 py-2">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(PERMISSION_LABELS).map(([permission, label]) => (
                <tr key={permission} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-700">
                    {label}
                  </td>
                  {APP_ROLES.map(role => (
                    <td key={role} className="px-3 py-2">
                      {ROLE_PERMISSION_MATRIX[
                        permission as keyof typeof ROLE_PERMISSION_MATRIX
                      ].includes(role) ? (
                        <span className="font-semibold text-emerald-600">
                          Да
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {APP_ROLES.map(role => (
            <div key={role} className="rounded-lg bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-700">
                {ROLE_LABELS[role]}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {ROLE_DESCRIPTIONS[role]}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold">Добавить сотрудника</h2>
          <p className="mt-1 text-sm text-slate-500">
            Роль, подразделение и блоки назначаются сразу. Система сгенерирует
            одноразовый временный пароль — передайте его сотруднику вместе с
            Email. При первом входе сотрудник задаст собственный пароль.
          </p>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-[1fr_1fr_170px_180px_auto]">
          <Input
            value={inviteName}
            onChange={event => setInviteName(event.target.value)}
            placeholder="Имя пользователя"
          />
          <Input
            value={inviteEmail}
            onChange={event => setInviteEmail(event.target.value)}
            placeholder="Email"
            type="email"
          />
          <Select
            value={inviteRole}
            onValueChange={value => {
              setInviteRole(value as AppRole);
              if (value === "admin") setInviteBlocks([]);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APP_ROLES.map(value => (
                <SelectItem key={value} value={value}>
                  {ROLE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={inviteDepartmentId}
            onValueChange={setInviteDepartmentId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Подразделение" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Без подразделения</SelectItem>
              {departments.data?.map(department => (
                <SelectItem key={department.id} value={String(department.id)}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={
              !inviteName.trim() || !inviteEmail.trim() || createUser.isPending
            }
            onClick={() =>
              createUser.mutate({
                name: inviteName.trim(),
                email: inviteEmail.trim(),
                role: inviteRole,
                departmentId:
                  inviteDepartmentId === "none"
                    ? null
                    : Number(inviteDepartmentId),
                managedBlocks: inviteRole === "admin" ? [] : inviteBlocks,
              })
            }
          >
            {createUser.isPending ? "Создаём…" : "Добавить и выдать пароль"}
          </Button>
        </div>
        <div className="grid gap-4 border-t border-slate-100 px-5 pb-5 pt-4 md:grid-cols-[1fr_1fr]">
          <label className="text-xs font-medium text-slate-500">
            Блоки сотрудника
            <select
              multiple
              value={inviteRole === "admin" ? [] : inviteBlocks}
              onChange={event =>
                setInviteBlocks(
                  Array.from(
                    event.target.selectedOptions,
                    option => option.value
                  )
                )
              }
              disabled={inviteRole === "admin"}
              className="mt-1 h-28 w-full rounded-md border border-slate-200 bg-white p-1 text-xs text-slate-700 disabled:bg-slate-100"
            >
              {BLOCK_FOLDER_OPTIONS.map(block => (
                <option key={block} value={block}>
                  {block}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-normal text-slate-400">
              {inviteRole === "admin"
                ? "Администратору блоки не нужны"
                : inviteBlocks.length
                  ? `Назначено: ${inviteBlocks.join(", ")}`
                  : "Пусто — доступ менеджера к блокам закрыт"}
            </span>
          </label>
        </div>
      </div>
      <div className="border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold">Пользователи и назначенные права</h2>
          <p className="mt-1 text-sm text-slate-500">
            Нельзя понизить или отключить себя, если это затронет единственного
            активного администратора. Изменения ролей, подразделений, блоков и
            статусов записываются в security audit.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {users.data?.map(user => {
            const managedBlocks = parseManagedBlocks(user.managedBlocks);
            const isSelf = user.id === me.data?.id;
            return (
              <div
                key={user.id}
                className="grid gap-4 px-5 py-4 xl:grid-cols-[1.1fr_150px_170px_190px_1fr] xl:items-start"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {user.name || "Без имени"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {user.email || `Пользователь #${user.id}`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="inline-flex rounded-full bg-[#fffaf0] px-2 py-1 text-[11px] font-semibold text-[#8a682d]">
                      {ROLE_LABELS[user.role]}
                    </span>
                    {!user.hasPassword ? (
                      <span className="inline-flex rounded-full bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700">
                        Пароль не выдан
                      </span>
                    ) : user.mustChangePassword ? (
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
                        {user.temporaryPasswordExpiresAt &&
                        new Date(user.temporaryPasswordExpiresAt).getTime() <=
                          Date.now()
                          ? "Временный пароль истёк"
                          : "Ждёт первого входа"}
                      </span>
                    ) : null}
                  </div>
                  {!isSelf && user.accountStatus !== "disabled" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-8 text-xs"
                      disabled={issueTemporaryPassword.isPending}
                      onClick={() => issuePasswordFor(user)}
                    >
                      <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                      {user.hasPassword
                        ? "Сбросить пароль"
                        : "Выдать временный пароль"}
                    </Button>
                  )}
                </div>
                <Select
                  value={user.role}
                  onValueChange={value =>
                    saveUser(user, { role: value as AppRole })
                  }
                  disabled={isSelf}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APP_ROLES.map(value => (
                      <SelectItem key={value} value={value}>
                        {ROLE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={user.accountStatus ?? "pending"}
                  onValueChange={value =>
                    saveUser(user, {
                      accountStatus: value as "pending" | "active" | "disabled",
                    })
                  }
                  disabled={isSelf}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(accountStatusLabels).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
                <Select
                  value={user.departmentId ? String(user.departmentId) : "none"}
                  onValueChange={value =>
                    saveUser(user, {
                      departmentId: value === "none" ? null : Number(value),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Подразделение" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без подразделения</SelectItem>
                    {departments.data?.map(department => (
                      <SelectItem
                        key={department.id}
                        value={String(department.id)}
                      >
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="text-xs font-medium text-slate-500">
                  Блоки менеджера
                  <select
                    multiple
                    value={user.role === "admin" ? [] : managedBlocks}
                    onChange={event =>
                      saveUser(user, {
                        managedBlocks: Array.from(
                          event.target.selectedOptions,
                          option => option.value
                        ),
                      })
                    }
                    disabled={user.role === "admin"}
                    className="mt-1 h-24 w-full rounded-md border border-slate-200 bg-white p-1 text-xs text-slate-700 disabled:bg-slate-100"
                  >
                    {BLOCK_FOLDER_OPTIONS.map(block => (
                      <option key={block} value={block}>
                        {block}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block font-normal text-slate-400">
                    {user.role === "admin"
                      ? "Администратору блоки не нужны"
                      : managedBlocks.length
                        ? `Назначено: ${managedBlocks.join(", ")}`
                        : "Блоки не назначены — доступ закрыт"}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
      <div className="border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Журнал security events</h2>
        <p className="mt-2 text-sm text-slate-500">
          Аудит создания сотрудников, выдачи временных паролей, изменений ролей, подразделений, блоков и
          статусов.
        </p>
        <div className="mt-4 space-y-2">
          {securityAudit.data?.map(entry => (
            <div
              key={entry.id}
              className="rounded-lg border border-slate-100 px-3 py-2 text-xs"
            >
              <span className="font-semibold text-slate-700">
                {entry.eventType}
              </span>
              <span className="ml-2 text-slate-400">
                {new Date(entry.createdAt).toLocaleString("ru-RU")}
              </span>
              <span className="ml-2 text-slate-500">
                actor #{entry.actorUserId ?? "—"} → target #
                {entry.targetUserId ?? "—"}
              </span>
              <p className="mt-1 text-slate-500">
                {entry.oldValue || "—"} → {entry.newValue || "—"}
              </p>
            </div>
          ))}
          {!securityAudit.data?.length && (
            <p className="text-sm text-slate-500">
              Security events пока не записаны.
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Справочник подразделений</h2>
          <p className="mt-2 text-sm text-slate-500">
            Подразделение хранится отдельно; ограничения менеджеров
            дополнительно работают по папкам блоков.
          </p>
          <div className="mt-5 space-y-2">
            {departments.data?.map(dept => (
              <div
                key={dept.id}
                className="border border-slate-100 px-3 py-2 text-sm"
              >
                {dept.name}
              </div>
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            <Input
              value={departmentName}
              onChange={event => setDepartmentName(event.target.value)}
              placeholder="Название подразделения"
            />
            <Button
              onClick={() => {
                if (departmentName.trim()) {
                  createDepartment.mutate({ name: departmentName.trim() });
                  setDepartmentName("");
                }
              }}
            >
              Добавить
            </Button>
          </div>
        </div>
        <div className="border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Права на документы</h2>
          <p className="mt-2 text-sm text-slate-500">
            Дополнительные точечные правила просмотра документов доступны
            администратору.
          </p>
          <div className="mt-4 space-y-3">
            <Select value={documentId} onValueChange={setDocumentId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите документ" />
              </SelectTrigger>
              <SelectContent>
                {documents.data?.map(doc => (
                  <SelectItem key={doc.id} value={String(doc.id)}>
                    {doc.fileName} · договор #{doc.contractId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={permissionTarget}
              onValueChange={setPermissionTarget}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="department">Подразделение</SelectItem>
                <SelectItem value="user">Пользователь</SelectItem>
              </SelectContent>
            </Select>
            <Select value={permissionId} onValueChange={setPermissionId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    permissionTarget === "user"
                      ? "Выберите пользователя"
                      : "Выберите подразделение"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {permissionTarget === "user"
                  ? users.data?.map(user => (
                      <SelectItem key={user.id} value={String(user.id)}>
                        {user.name || user.email || `Пользователь #${user.id}`}
                      </SelectItem>
                    ))
                  : departments.data?.map(dept => (
                      <SelectItem key={dept.id} value={String(dept.id)}>
                        {dept.name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!documentId || !permissionId}
                onClick={() =>
                  setPermission.mutate({
                    documentId: Number(documentId),
                    userId:
                      permissionTarget === "user" ? Number(permissionId) : null,
                    departmentId:
                      permissionTarget === "department"
                        ? Number(permissionId)
                        : null,
                    canView: "yes",
                  })
                }
              >
                Разрешить просмотр
              </Button>
              <Button
                variant="outline"
                disabled={!documentId || !permissionId}
                onClick={() =>
                  setPermission.mutate({
                    documentId: Number(documentId),
                    userId:
                      permissionTarget === "user" ? Number(permissionId) : null,
                    departmentId:
                      permissionTarget === "department"
                        ? Number(permissionId)
                        : null,
                    canView: "no",
                  })
                }
              >
                Запретить просмотр
              </Button>
            </div>
          </div>
          {permissions.data?.length ? (
            <div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
              <p>Текущие правила:</p>
              {permissions.data.map(rule => (
                <div
                  key={rule.id}
                  className="mt-2 flex items-center justify-between gap-2"
                >
                  <span>
                    {rule.userId
                      ? `Пользователь #${rule.userId}`
                      : `Подразделение #${rule.departmentId}`}{" "}
                    — {rule.canView === "yes" ? "разрешено" : "запрещено"}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPermission.mutate({
                          documentId: rule.documentId,
                          userId: rule.userId ?? null,
                          departmentId: rule.departmentId ?? null,
                          canView: rule.canView === "yes" ? "no" : "yes",
                        })
                      }
                    >
                      {rule.canView === "yes" ? "Запретить" : "Разрешить"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => revokePermission.mutate({ id: rule.id })}
                    >
                      Отозвать
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Журнал действий по договорам</h2>
        <p className="mt-2 text-sm text-slate-500">
          Фиксируются просмотры, создание и изменения с указанием пользователя и
          времени.
        </p>
        <div className="mt-4">
          <Select value={contractId} onValueChange={setContractId}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите договор" />
            </SelectTrigger>
            <SelectContent>
              {contracts.data?.map(contract => (
                <SelectItem key={contract.id} value={String(contract.id)}>
                  #{contract.id} · {contract.tenantName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-4 space-y-3">
          {audit.data?.map(entry => (
            <div
              key={entry.id}
              className="border-b border-slate-100 pb-3 text-sm"
            >
              <p className="font-medium">
                {entry.action === "viewed"
                  ? "Просмотр"
                  : entry.action === "created"
                    ? "Создание"
                    : "Изменение"}
              </p>
              <p className="text-xs text-slate-500">
                Пользователь{" "}
                {users.data?.find(user => user.id === entry.actorUserId)
                  ?.name || `#${entry.actorUserId ?? "—"}`}{" "}
                · {new Date(entry.createdAt).toLocaleString("ru-RU")}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {entry.details || "—"}
              </p>
            </div>
          ))}
          {contractId && !audit.data?.length && (
            <p className="text-sm text-slate-500">Записей пока нет.</p>
          )}
        </div>
      </div>
    </section>
  );
}
