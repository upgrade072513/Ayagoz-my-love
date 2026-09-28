import {
  parseTariffSchedule,
  tariffOn,
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
  // Split the billed days into runs with the same rate.
  const parts: NonNullable<CalculatedAccrual["parts"]> = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 86400000) {
    const day = iso(new Date(t));
    const rate = schedule.length ? tariffOn(day, schedule, base) : base;
    const last = parts[parts.length - 1];
    if (
      last &&
      last.tariffType === rate.tariffType &&
      last.tariffAmount === rate.tariffAmount
    ) {
      last.to = day;
      last.days += 1;
    } else
      parts.push({ from: day, to: day, days: 1, ...rate, amount: 0 });
  }
  for (const part of parts)
    part.amount =
      part.tariffType === "daily"
        ? round2(part.days * part.tariffAmount)
        : round2((part.days / daysInMonth) * part.tariffAmount);
  const main = parts.reduce((best, part) => (part.days > best.days ? part : best));
  const allDaily = parts.every(part => part.tariffType === "daily");
  const quantity = allDaily ? activeDays : round2(activeDays / daysInMonth);
  const amount =
    parts.length === 1
      ? parts[0].amount
      : round2(parts.reduce((sum, part) => sum + part.amount, 0));
  return {
    serviceFrom: iso(from),
    serviceTo: iso(to),
    quantity,
    amount,
    tariffType: main.tariffType,
    tariffAmount: main.tariffAmount,
    ...(parts.length > 1 ? { parts } : {}),
  };
}

/** Accrual note for a month with several rates: «01.01–14.01: 150 000 ₸/мес — 67 741,94 ₸; …». */
export function describeAccrualParts(parts: CalculatedAccrual["parts"]) {
  if (!parts || parts.length < 2) return null;
  const d = (value: string) => value.slice(8, 10) + "." + value.slice(5, 7);
  return (
    "Смена тарифа в месяце: " +
    parts
      .map(
        part =>
          `${d(part.from)}–${d(part.to)}: ${part.tariffAmount.toLocaleString("ru-RU")} ₸/${part.tariffType === "daily" ? "сутки" : "мес"} — ${part.amount.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`
      )
      .join("; ")
  );
}
