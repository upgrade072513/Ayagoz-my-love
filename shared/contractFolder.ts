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

/**
 * The building a resident lives in (Блок А1 = 38, А2 = 44, А3 = 39, А4 = 45), for category folders such
 * as «Family Student - Блок А3»: first from the folder name, then from the address. DEFAULT_BLOCK_FOLDER
 * when neither says.
 */
export function buildingOf(
  propertyName?: unknown,
  unitName?: unknown,
  folder?: unknown
): string {
  const folderText = String(folder ?? "");
  const lettered = folderText.match(/блок\s*[АA]\s*([1-9])/iu);
  if (lettered) return `Блок А${lettered[1]}`;
  if (/\d{2}/.test(folderText)) {
    const fromFolder = deriveBlockFolder(folderText, null, null);
    if (/^Блок А\d$/.test(fromFolder)) return fromFolder;
  }
  const fromAddress = deriveBlockFolder(propertyName, unitName, null);
  return /^Блок А\d$/.test(fromAddress) ? fromAddress : DEFAULT_BLOCK_FOLDER;
}
