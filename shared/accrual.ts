export type TariffType = "monthly" | "daily";

export type AccrualInput = {
  startDate: string;
  endDate: string;
  terminationDate?: string | null;
  tariffType: TariffType;
  tariffAmount: number;
};

export type CalculatedAccrual = {
  serviceFrom: string;
  serviceTo: string;
  quantity: number;
  amount: number;
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
  const quantity =
    input.tariffType === "daily"
      ? activeDays
      : round2(activeDays / daysInMonth);
  const amount =
    input.tariffType === "daily"
      ? round2(activeDays * input.tariffAmount)
      : round2((activeDays / daysInMonth) * input.tariffAmount);
  return { serviceFrom: iso(from), serviceTo: iso(to), quantity, amount };
}
