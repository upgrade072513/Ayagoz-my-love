import React, { useState } from "react";
import { Hash, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PlanItem = { id: number; tenantName: string; oldNumber: string; newNumber: string; conflict?: string };

/** «Дополнить номера»: «374-2026» → «374-2026/08-23» for every contract that has only «номер-год». */
export function NumberSuffixButton() {
  const [open, setOpen] = useState(false);
  const [suffix, setSuffix] = useState("/08-23");
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const utils = trpc.useUtils();
  const run = trpc.contracts.appendNumberSuffix.useMutation({
    onError: error => toast.error(error.message),
  });
  const preview = (value = suffix) =>
    run.mutate({ suffix: value, dryRun: true }, { onSuccess: result => setPlan(result.plan as PlanItem[]) });
  const apply = () =>
    run.mutate(
      { suffix, dryRun: false },
      {
        onSuccess: result => {
          toast.success(`Номера дополнены: ${result.updated}`);
          utils.contracts.list.invalidate();
          utils.accruals.invalidate();
          setOpen(false);
          setPlan(null);
        },
      }
    );
  const ready = (plan ?? []).filter(item => !item.conflict);
  return (
    <>
      <Button variant="outline" className="h-10 rounded-full px-4" onClick={() => { setOpen(true); preview(); }} title="Дописать «/08-23» к номерам вида «374-2026»">
        <Hash className="h-4 w-4" />
        Дополнить номера
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#18202d]/60 p-4" role="dialog" aria-modal="true" aria-label="Дополнить номера договоров">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-base font-semibold text-slate-900">Дополнить номера договоров</p>
                <p className="mt-0.5 text-xs text-slate-500">Только номера вида «374-2026» (номер и год без окончания). Остальные не меняются.</p>
              </div>
              <Button size="icon" variant="ghost" aria-label="Закрыть" onClick={() => { setOpen(false); setPlan(null); }}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <label className="text-sm text-slate-700">
                Дописать в конец
                <Input className="mt-1 w-40" value={suffix} onChange={event => setSuffix(event.target.value)} aria-label="Окончание номера" />
              </label>
              <Button size="sm" variant="outline" onClick={() => preview()} disabled={run.isPending || !suffix.trim()}>Показать, что изменится</Button>
              <span className="text-xs text-slate-500">Пример: 374-2026 → 374-2026{suffix}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {plan === null ? (
                <p className="px-5 py-8 text-center text-sm text-slate-500">Считаем…</p>
              ) : plan.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-500">Номеров без окончания не найдено.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_#e2e8f0]">
                    <tr><th className="px-4 py-2">Плательщик</th><th className="px-4 py-2">Было</th><th className="px-4 py-2">Станет</th></tr>
                  </thead>
                  <tbody>
                    {plan.map(item => (
                      <tr key={item.id} className={"border-b border-slate-100 " + (item.conflict ? "bg-amber-50" : "")}>
                        <td className="px-4 py-2">{item.tenantName}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-500">{item.oldNumber}</td>
                        <td className="whitespace-nowrap px-4 py-2 font-medium">
                          {item.newNumber}
                          {item.conflict && <div className="text-xs font-normal text-amber-700">{item.conflict} — пропущен</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <Button variant="ghost" onClick={() => { setOpen(false); setPlan(null); }}>Отмена</Button>
              <Button disabled={!ready.length || run.isPending} onClick={() => { if (window.confirm(`Изменить номера у ${ready.length} договоров?`)) apply(); }}>
                {run.isPending ? "Сохраняем…" : `Дополнить номера (${ready.length})`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
