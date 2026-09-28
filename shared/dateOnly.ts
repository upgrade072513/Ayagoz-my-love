export function toDateOnly(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()))
      throw new Error("Некорректная дата договора");
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()))
    throw new Error("Некорректная дата договора");
  return parsed.toISOString().slice(0, 10);
}
