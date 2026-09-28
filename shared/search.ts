export function normalizeSearchText(value: unknown): string {
  if (value instanceof Date) {
    return `${value.toISOString()} ${value.toLocaleDateString("ru-RU")}`
      .toLocaleLowerCase("ru-RU")
      .trim();
  }
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .trim();
}

export function matchesSearch(query: string, values: unknown[]): boolean {
  const normalizedQuery = normalizeSearchText(query);
  return (
    !normalizedQuery ||
    values.some(value => normalizeSearchText(value).includes(normalizedQuery))
  );
}

export function filterBySearch<T>(
  rows: T[],
  query: string,
  getValues: (row: T) => unknown[]
): T[] {
  return rows.filter(row => matchesSearch(query, getValues(row)));
}

export function visibleTariffLabel(value: unknown): string {
  return value === "daily" ? "за сутки" : "за месяц";
}

export function visibleContractStatusLabel(value: unknown): string {
  return value === "active"
    ? "Активен"
    : value === "paused"
      ? "Пауза"
      : "Завершён";
}

export function visiblePaymentStatusLabel(value: unknown): string {
  return (
    (
      {
        issued: "Выставлен",
        partially_paid: "Частично оплачен",
        paid: "Оплачен",
        overdue: "Просрочен",
        disputed: "Спорный",
        cancelled: "Отменён",
      } as Record<string, string>
    )[String(value)] ?? String(value ?? "—")
  );
}

export function visiblePaymentMethodLabel(value: unknown): string {
  return (
    (
      {
        bank: "Банк",
        portal: "NU Portal",
        card: "Карта",
        cash: "Наличные",
        other: "Другое",
      } as Record<string, string>
    )[String(value)] ?? String(value ?? "—")
  );
}

export function visibleEmailStatusLabel(value: unknown): string {
  return value === "sent"
    ? "Отправлен"
    : value === "failed"
      ? "Ошибка"
      : "Не отправлен";
}
