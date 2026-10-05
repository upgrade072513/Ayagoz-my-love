import React, { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

type Group = { period: string; block: string; status: string; count: number; amount: number };

const money = (value: number) =>
  `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`;
const monthName = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  const text = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
  return text.charAt(0).toUpperCase() + text.slice(1).replace(" г.", "");
};
const sum = (groups: Group[]) => {
  let amount = 0;
  let count = 0;
  let invoiced = 0;
  for (const group of groups) {
    amount += group.amount;
    count += group.count;
    if (group.status === "invoiced") invoiced += group.amount;
  }
  return { amount: Math.round(amount * 100) / 100, count, invoiced: Math.round(invoiced * 100) / 100, draft: Math.round((amount - invoiced) * 100) / 100 };
};

/** Accrual totals: the selected month (by block), the year, all time, and a month-by-block table. */
export function AccrualSummary({
  period,
  onPickPeriod,
  onPickBlock,
  activeBlock = "all",
}: {
  period: string;
  onPickPeriod?: (period: string) => void;
  onPickBlock?: (block: string) => void;
  activeBlock?: string;
}) {
  const summary = trpc.accruals.summary.useQuery(undefined, { retry: false });
  const [showMonths, setShowMonths] = useState(false);
  const groups = (summary.data ?? []) as Group[];
  const year = period.slice(0, 4);
  const view = useMemo(() => {
    const month = groups.filter(group => group.period === period);
    const yearGroups = groups.filter(group => group.period.startsWith(`${year}-`));
    const blocks = Array.from(new Set(groups.map(group => group.block))).sort((a, b) => a.localeCompare(b, "ru"));
    const monthBlocks = blocks
      .map(block => ({ block, ...sum(month.filter(group => group.block === block)) }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.amount - a.amount);
    const periods = Array.from(new Set(groups.map(group => group.period))).sort().reverse();
    const byMonth = periods.map(p => {
      const rows = groups.filter(group => group.period === p);
      return {
        period: p,
        total: sum(rows),
        blocks: Object.fromEntries(blocks.map(block => [block, sum(rows.filter(group => group.block === block)).amount])),
      };
    });
    const months = new Set(groups.map(group => group.period)).size;
    const all = sum(groups);
    return {
      month: sum(month),
      monthBlocks,
      year: sum(yearGroups),
      yearMonths: new Set(yearGroups.map(group => group.period)).size,
      all,
      average: months ? Math.round((all.amount / months) * 100) / 100 : 0,
      months,
      blocks,
      byMonth,
    };
  }, [groups, period, year]);

  if (summary.isLoading) return <div className="ios-card p-4 text-sm text-slate-500">Считаем итоги начислений…</div>;
  if (summary.error) return null;

  return (
    <section className="ios-card space-y-4 p-4 sm:p-5" aria-label="Итоги начислений">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">Итоги начислений</h3>
        <span className="text-xs text-slate-500">по всем блокам, к которым у вас есть доступ</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl bg-[#fff6df] p-4">
          <p className="text-xs font-medium text-[#8a682d]">{monthName(period)}</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{money(view.month.amount)}</p>
          <p className="mt-1 text-xs text-slate-500">
            начислений: {view.month.count}
            {view.month.count > 0 && <> · в счетах {money(view.month.invoiced)} · черновики {money(view.month.draft)}</>}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs font-medium text-slate-500">За {year} год</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{money(view.year.amount)}</p>
          <p className="mt-1 text-xs text-slate-500">месяцев с начислениями: {view.yearMonths} · начислений: {view.year.count}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs font-medium text-slate-500">За всё время</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{money(view.all.amount)}</p>
          <p className="mt-1 text-xs text-slate-500">в счетах {money(view.all.invoiced)} · черновики {money(view.all.draft)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs font-medium text-slate-500">В среднем за месяц</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{money(view.average)}</p>
          <p className="mt-1 text-xs text-slate-500">по {view.months} мес.</p>
        </div>
      </div>
      {view.monthBlocks.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">По блокам за {monthName(period).toLowerCase()}</p>
          <div className="flex flex-wrap gap-2">
            {view.monthBlocks.map(item => (
              <button
                type="button"
                key={item.block}
                onClick={() => onPickBlock?.(activeBlock === item.block ? "all" : item.block)}
                className={"rounded-xl border px-3 py-2 text-left text-sm transition " + (activeBlock === item.block ? "border-[#c7a35f] bg-[#fff6df]" : "border-slate-200 bg-white hover:border-[#c7a35f]")}
                title="Показать начисления только этого блока"
              >
                <span className="block text-xs text-slate-500">{item.block} · {item.count}</span>
                <span className="font-semibold text-slate-900">{money(item.amount)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {view.byMonth.length > 0 && (
        <div>
          <button type="button" className="text-sm font-medium text-[#8a682d]" onClick={() => setShowMonths(value => !value)}>
            {showMonths ? "Скрыть" : "Показать"} суммы по месяцам и блокам
          </button>
          {showMonths && (
            <div className="mt-2 max-h-[360px] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Месяц</th>
                    <th className="px-3 py-2 text-right">Итого</th>
                    {view.blocks.map(block => (
                      <th key={block} className="whitespace-nowrap px-3 py-2 text-right">{block}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.byMonth.map(row => (
                    <tr key={row.period} className={"border-t border-slate-100 " + (row.period === period ? "bg-[#fffaf0]" : "")}>
                      <td className="whitespace-nowrap px-3 py-2">
                        <button type="button" className="text-left hover:text-[#8a682d]" onClick={() => onPickPeriod?.(row.period)} title="Открыть начисления за этот месяц">
                          {monthName(row.period)}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{money(row.total.amount)}</td>
                      {view.blocks.map(block => (
                        <td key={block} className="whitespace-nowrap px-3 py-2 text-right text-slate-600">{row.blocks[block] ? money(row.blocks[block]) : "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <tr>
                    <td className="px-3 py-2">Всего</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{money(view.all.amount)}</td>
                    {view.blocks.map(block => (
                      <td key={block} className="whitespace-nowrap px-3 py-2 text-right">{money(sum(groups.filter(group => group.block === block)).amount)}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
