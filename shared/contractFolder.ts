export const BLOCK_FOLDER_OPTIONS = [
  "Блок А1",
  "Блок А2",
  "Блок А3",
  "Блок А4",
  "ХВ Астана",
  "Старосты",
  "Иные лица студ блоки",
] as const;

export const DEFAULT_BLOCK_FOLDER = "Иные лица студ блоки";

export function deriveBlockFolder(
  propertyName?: unknown,
  unitName?: unknown,
  explicit?: unknown
) {
  const chosen = String(explicit ?? "").trim();
  if (chosen) return chosen;
  const source = [String(propertyName ?? ""), String(unitName ?? "")]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ru");
  if (/кошкарбаева|байтурсынова|хв\s*астан|хайвилл|highville/.test(source))
    return "ХВ Астана";
  if (/общежит/.test(source) || /(?:\d+\s*[dд]|[dд]\s*\d+)/.test(source))
    return "Старосты";
  if (/блок\s*44\b|\b44\s*блок/.test(source)) return "Блок А2";
  if (/блок\s*45\b|\b45\s*блок/.test(source)) return "Блок А4";
  if (/\b39\b/.test(source)) return "Блок А3";
  if (/\b38\b/.test(source)) return "Блок А1";
  if (/старост/.test(source)) return "Старосты";
  for (const folder of ["Блок А1", "Блок А2", "Блок А3", "Блок А4"] as const) {
    const code = folder.slice(-2).toLocaleLowerCase("ru");
    if (
      source.includes(code) ||
      source.includes(folder.toLocaleLowerCase("ru"))
    )
      return folder;
  }
  return DEFAULT_BLOCK_FOLDER;
}
