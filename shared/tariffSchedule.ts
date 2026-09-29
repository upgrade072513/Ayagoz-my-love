// A contract whose rate changes during its term («с 01.09 по 31.12 — 150 000 ₸/мес, с 01.01 по 30.06 — 165 000 ₸/мес»).
// Also bed bookings («за 3 койко-места с 27 по 29 августа по 5 500 ₸ в сутки»): each line is billed as
// units × days × rate, lines may overlap and are added up.
// Stored on the contract as a JSON list of lines; days not covered by any line use the contract's base tariff.
export type TariffType = "monthly" | "daily";
export type TariffPeriod = {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  tariffType: TariffType;
  amount: number;
  /** Number of beds/places billed on this line (койко-мест); 1 when omitted. */
  units?: number;
};

export const unitsOf = (period: Pick<TariffPeriod, "units">) =>
  period.units && period.units > 0 ? period.units : 1;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: unknown): string | null => {
  const text = String(value ?? "").slice(0, 10);
  if (!ISO.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text
    ? null
    : text;
};
const toAmount = (value: unknown) => {
  const n =
    typeof value === "number"
      ? value
      : Number(
          String(value ?? "")
            .replace(/[\s  ]/g, "")
            .replace(/[^\d.,]/g, "")
            .replace(",", ".")
        );
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** Accepts the DB value (JSON string), an array from the client/AI, or garbage; returns clean sorted periods. */
export function parseTariffSchedule(
  value: unknown,
  fallbackType: TariffType = "monthly"
): TariffPeriod[] {
  let raw: unknown = value;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const periods: TariffPeriod[] = [];
  for (const item of raw.slice(0, 24)) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const from = validDate(entry.from ?? entry.startDate);
    const to = validDate(entry.to ?? entry.endDate);
    const amount = toAmount(entry.amount ?? entry.tariffAmount);
    if (!from || !to || from > to || amount == null) continue;
    const type = entry.tariffType === "daily" || entry.tariffType === "monthly"
      ? (entry.tariffType as TariffType)
      : fallbackType;
    const unitsRaw = Number(entry.units ?? entry.beds ?? 1);
    const units =
      Number.isInteger(unitsRaw) && unitsRaw >= 1 && unitsRaw <= 1000 ? unitsRaw : 1;
    periods.push(
      units === 1
        ? { from, to, tariffType: type, amount }
        : { from, to, tariffType: type, amount, units }
    );
  }
  return periods.sort((a, b) => a.from.localeCompare(b.from));
}

/** Human-readable problems (overlaps, outside the contract term); empty when the schedule is fine. */
export function validateTariffSchedule(
  periods: TariffPeriod[],
  contract?: { startDate?: string | null; endDate?: string | null }
): string[] {
  const errors: string[] = [];
  const sorted = [...periods].sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (p.from > p.to)
      errors.push(`Период тарифа ${p.from} — ${p.to}: дата начала позже окончания`);
    if (contract?.startDate && p.to < contract.startDate)
      errors.push(`Период тарифа ${p.from} — ${p.to} раньше начала договора`);
    if (contract?.endDate && p.from > contract.endDate)
      errors.push(`Период тарифа ${p.from} — ${p.to} позже окончания договора`);
  }
  return errors;
}

/** Lines that overlap in time — their sums are added (bed bookings); shown as a hint, not an error. */
export function overlappingPeriods(periods: TariffPeriod[]) {
  const sorted = [...periods].sort((a, b) => a.from.localeCompare(b.from));
  return sorted.some((p, i) => i > 0 && p.from <= sorted[i - 1].to);
}

/** Worth keeping: a real change of rate, several places, or several people/beds at once. */
export function isMeaningfulSchedule(periods: TariffPeriod[]) {
  if (!periods.length) return false;
  if (periods.some(p => unitsOf(p) > 1)) return true;
  if (periods.length < 2) return false;
  return (
    overlappingPeriods(periods) ||
    new Set(periods.map(p => `${p.tariffType}:${p.amount}`)).size > 1
  );
}

/** JSON for the database; null when there is no change of rate. */
export function serializeTariffSchedule(periods: TariffPeriod[] | null | undefined) {
  return periods && periods.length ? JSON.stringify(periods) : null;
}

/** The rate that applies on a given day (schedule first, base tariff otherwise). */
export function tariffOn(
  day: string,
  periods: TariffPeriod[],
  base: { tariffType: TariffType; tariffAmount: number }
) {
  const hit = periods.find(p => p.from <= day && day <= p.to);
  return hit
    ? { tariffType: hit.tariffType, tariffAmount: hit.amount }
    : { tariffType: base.tariffType, tariffAmount: base.tariffAmount };
}

const fmt = (iso: string) => iso.split("-").reverse().join(".");
export function describeTariffSchedule(periods: TariffPeriod[]) {
  return periods
    .map(
      p =>
        `${fmt(p.from)}–${fmt(p.to)}: ${unitsOf(p) > 1 ? `${unitsOf(p)} мест × ` : ""}${p.amount.toLocaleString("ru-RU")} ₸/${p.tariffType === "daily" ? "сутки" : "мес"}`
    )
    .join("; ");
}
