import { toDateOnly } from "./dateOnly";

type LifecycleContract = {
  endDate: unknown;
  terminationDate?: unknown | null;
  archivedAt?: unknown | null;
};

export function getContractEffectiveEndDate(contract: LifecycleContract): string {
  return toDateOnly(contract.terminationDate ?? contract.endDate);
}

export function shouldAutoArchiveContract(contract: LifecycleContract, today: string): boolean {
  if (contract.archivedAt) return false;
  return getContractEffectiveEndDate(contract) <= today;
}
