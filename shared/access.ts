import { managerCanAccessBlock, parseManagedBlocks } from "./managerAccess";

export type AccessUser = {
  id: number;
  role: string;
  departmentId?: number | null;
  managedBlocks?: string | null;
};
export type AccessContract =
  | { departmentId?: number | null; blockFolder?: string | null }
  | undefined;
export type AccessPermission = {
  userId?: number | null;
  departmentId?: number | null;
  canView: "yes" | "no";
};

export function canViewDocument(
  user: AccessUser,
  contract: AccessContract,
  permissions: AccessPermission[]
) {
  if (user.role === "admin") return true;
  if (
    !managerCanAccessBlock(user.role, user.managedBlocks, contract?.blockFolder)
  )
    return false;
  const userRule = permissions.find(rule => rule.userId === user.id);
  if (userRule) return userRule.canView === "yes";
  return true;
}

export function canAccessContractBlock(
  user: AccessUser,
  blockFolder: string | null | undefined
) {
  return managerCanAccessBlock(user.role, user.managedBlocks, blockFolder);
}

export function accessibleBlocks(user: AccessUser) {
  return user.role === "admin" ? [] : parseManagedBlocks(user.managedBlocks);
}
