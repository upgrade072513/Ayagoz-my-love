export const APP_ROLES = ["admin", "manager"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Администратор",
  manager: "Менеджер",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin:
    "Полный доступ ко всем блокам, пользователям, отчётам и необратимым операциям",
  manager: "Загрузка и изменение договоров только в назначенных блоках",
};

type Permission =
  | "manageContracts"
  | "manageFolders"
  | "manageAccruals"
  | "manageInvoices"
  | "managePayments"
  | "manageUsers"
  | "manageDocumentPermissions"
  | "destructive";

const permissionRoles: Record<Permission, readonly AppRole[]> = {
  manageContracts: ["admin", "manager"],
  manageFolders: ["admin"],
  manageAccruals: ["admin", "manager"],
  manageInvoices: ["admin", "manager"],
  managePayments: ["admin", "manager"],
  manageUsers: ["admin"],
  manageDocumentPermissions: ["admin"],
  destructive: ["admin"],
};

export function hasPermission(role: string, permission: Permission) {
  return (permissionRoles[permission] ?? []).includes(role as AppRole);
}

export function assertPermission(
  role: string,
  permission: Permission,
  message?: string
): asserts role is AppRole {
  if (!hasPermission(role, permission))
    throw new Error(message ?? "Недостаточно прав для выполнения операции");
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  manageContracts: "Договоры: загрузка, создание, изменение и архив",
  manageFolders: "Папки и перенос договоров в назначенных блоках",
  manageAccruals: "Начисления назначенных блоков",
  manageInvoices: "Счета и экспорт назначенных блоков",
  managePayments: "Контроль оплат",
  manageUsers: "Пользователи и назначение блоков",
  manageDocumentPermissions: "Точечные права на документы",
  destructive: "Безвозвратное удаление",
};

export type { Permission };
export const ROLE_PERMISSION_MATRIX = permissionRoles;

export function roleCan(role: AppRole, permission: Permission) {
  return hasPermission(role, permission);
}
