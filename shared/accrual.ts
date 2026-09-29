import {
  parseTariffSchedule,
  unitsOf,
  type TariffPeriod,
  type TariffType,
} from "./tariffSchedule";
export type { TariffType } from "./tariffSchedule";

export type AccrualInput = {
  startDate: string;
  endDate: string;
  terminationDate?: string | null;
  tariffType: TariffType;
  tariffAmount: number;
  /** Rate changes within the term (JSON string from the DB or parsed list). */
  tariffSchedule?: TariffPeriod[] | string | null;
};

export type CalculatedAccrual = {
  serviceFrom: string;
  serviceTo: string;
  quantity: number;
  amount: number;
  /** Rate that applies to most of the billed days (shown on the accrual line). */
  tariffType: TariffType;
  tariffAmount: number;
  /** Several rates within this month: one part per rate. */
  parts?: Array<{
    from: string;
    to: string;
    days: number;
    units: number;
    tariffType: TariffType;
    tariffAmount: number;
    amount: number;
  }>;
};

const iso = (date: Date) => date.toISOString().slice(0, 10);
const parse = (value: string) => new Date(`${value}T00:00:00Z`);
const round2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateAccrual(
  input: AccrualInput,
  period: string
): CalculatedAccrual | null {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12)
    throw new Error("Период должен быть в формате YYYY-MM");
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0));
  const start = parse(input.startDate);
  const end = parse(
    input.terminationDate && input.terminationDate < input.endDate
      ? input.terminationDate
      : input.endDate
  );
  const from = new Date(Math.max(start.getTime(), periodStart.getTime()));
  const to = new Date(Math.min(end.getTime(), periodEnd.getTime()));
  if (from > to) return null;
  const activeDays = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  const daysInMonth = periodEnd.getUTCDate();
  const schedule = parseTariffSchedule(input.tariffSchedule, input.tariffType);
  const base = { tariffType: input.tariffType, tariffAmount: input.tariffAmount };
  const parts: NonNullable<CalculatedAccrual["parts"]> = [];
  const billedFrom = iso(from);
  const billedTo = iso(to);
  const daysBetween = (a: string, b: string) =>
    Math.floor((parse(b).getTime() - parse(a).getTime()) / 86400000) + 1;
  // Every schedule line is billed on its own (units × days × rate); lines may overlap (bed bookings).
  for (const line of schedule) {
    const lineFrom = line.from > billedFrom ? line.from : billedFrom;
    const lineTo = line.to < billedTo ? line.to : billedTo;
    if (lineFrom > lineTo) continue;
    parts.push({
      from: lineFrom,
      to: lineTo,
      days: daysBetween(lineFrom, lineTo),
      units: unitsOf(line),
      tariffType: line.tariffType,
      tariffAmount: line.amount,
      amount: 0,
    });
  }
  // Days no line covers are billed at the contract's base rate.
  let run: string | null = null;
  const closeRun = (last: string) => {
    if (!run) return;
    parts.push({ from: run, to: last, days: daysBetween(run, last), units: 1, ...base, amount: 0 });
    run = null;
  };
  for (let t = from.getTime(); t <= to.getTime(); t += 86400000) {
    const day = iso(new Date(t));
    const covered = schedule.some(line => line.from <= day && day <= line.to);
    if (!covered && !run) run = day;
    if (covered && run) closeRun(iso(new Date(t - 86400000)));
  }
  closeRun(billedTo);
  if (!parts.length) return null;
  parts.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  for (const part of parts)
    part.amount =
      part.tariffType === "daily"
        ? round2(part.units * part.days * part.tariffAmount)
        : round2(part.units * (part.days / daysInMonth) * part.tariffAmount);
  const main = parts.reduce((best, part) =>
    part.days * part.units > best.days * best.units ? part : best
  );
  const allDaily = parts.every(part => part.tariffType === "daily");
  const quantity = allDaily
    ? parts.reduce((sum, part) => sum + part.units * part.days, 0) // bed-days
    : round2(parts.reduce((sum, part) => sum + part.units * part.days, 0) / daysInMonth);
  const amount =
    parts.length === 1
      ? parts[0].amount
      : round2(parts.reduce((sum, part) => sum + part.amount, 0));
  const detailed = parts.length > 1 || parts[0].units > 1;
  return {
    serviceFrom: iso(from),
    serviceTo: iso(to),
    quantity,
    amount,
    tariffType: main.tariffType,
    tariffAmount: main.tariffAmount,
    ...(detailed ? { parts } : {}),
  };
}

/** Accrual note for a month with several rates: «01.01–14.01: 150 000 ₸/мес — 67 741,94 ₸; …». */
export function describeAccrualParts(parts: CalculatedAccrual["parts"]) {
  if (!parts || !parts.length) return null;
  if (parts.length === 1 && parts[0].units <= 1) return null;
  const d = (value: string) => value.slice(8, 10) + "." + value.slice(5, 7);
  const money = (value: number) =>
    value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const beds = parts.some(part => part.units > 1) || overlapping(parts);
  return (
    (beds ? "Расчёт по койко-местам: " : "Смена тарифа в месяце: ") +
    parts
      .map(part => {
        const rate = `${part.tariffAmount.toLocaleString("ru-RU")} ₸/${part.tariffType === "daily" ? "сутки" : "мес"}`;
        return beds
          ? `${d(part.from)}–${d(part.to)}: ${part.units} мест × ${part.days} дн. × ${rate} = ${money(part.amount)} ₸`
          : `${d(part.from)}–${d(part.to)}: ${rate} — ${money(part.amount)} ₸`;
      })
      .join("; ")
  );
}
const overlapping = (parts: NonNullable<CalculatedAccrual["parts"]>) =>
  parts.some((part, i) => i > 0 && part.from <= parts[i - 1].to);
