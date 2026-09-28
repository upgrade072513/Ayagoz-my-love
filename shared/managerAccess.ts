import type { AppRole } from "./accessControl";

export function parseManagedBlocks(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is string =>
              typeof item === "string" && Boolean(item.trim())
          )
          .map(item => item.trim())
      : [];
  } catch {
    return value
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  }
}

export function serializeManagedBlocks(blocks: string[] | null | undefined) {
  return JSON.stringify(
    Array.from(
      new Set((blocks ?? []).map(block => block.trim()).filter(Boolean))
    )
  );
}

export function managerCanAccessBlock(
  role: AppRole | string,
  managedBlocks: string | null | undefined,
  blockFolder: string | null | undefined
) {
  if (role === "admin") return true;
  return (
    role === "manager" &&
    Boolean(blockFolder) &&
    parseManagedBlocks(managedBlocks).includes(blockFolder!)
  );
}
