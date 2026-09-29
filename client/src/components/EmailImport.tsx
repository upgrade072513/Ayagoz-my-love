import React, { useMemo, useRef, useState } from "react";
import { Mail, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

type Plan = {
  changes: Array<{
    contractId: number;
    contractNumber: string | null;
    tenantName: string;
    block: string | null;
    oldEmail: string | null;
    newEmail: string;
    matchedBy: "contractNumber" | "name" | "name+apartment" | "similarName" | "apartment";
    source: string;
    sourceName?: string;
    conflict?: string;
    review?: string;
  }>;
  listedWithoutEmail: Array<{ contractId: number; contractNumber: string | null; tenantName: string; source: string }>;
  notInFile: Array<{ contractId: number; contractNumber: string | null; tenantName: string; block: string | null; unit: string | null }>;
  unchanged: number;
  keptExisting: number;
  unmatched: Array<{ sheet: string; row: number; name: string; email: string; contractNumber: string | null; block: string | null; unit: string | null }>;
  unmatchedCount: number;
  ambiguous: Array<{ sheet: string; row: number; name: string; email: string; candidates: number }>;
  rowsRead: number;
  withoutEmail: number;
};

const MATCHED_BY: Record<Plan["changes"][number]["matchedBy"], string> = {
  contractNumber: "по номеру договора",
  name: "по ФИО",
  "name+apartment": "по ФИО и квартире",
  similarName: "по похожему ФИО (латиница/кириллица)",
  apartment: "по блоку и квартире — проверьте",
};

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

/** «Email из Excel»: reads addresses from a residents list and writes them to the matching contracts. */
export function EmailImportButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showUnmatched, setShowUnmatched] = useState(false);
  const utils = trpc.useUtils();
  const preview = trpc.contracts.previewEmailImport.useMutation({
    onSuccess: result => {
      const next = result as Plan;
      setPlan(next);
      // Uncertain matches (by apartment only, conflicting addresses) start unticked.
      setSelected(new Set(next.changes.filter(change => !change.review && !change.conflict).map(change => change.contractId)));
    },
    onError: error => toast.error(error.message),
  });
  const apply = trpc.contracts.applyEmailImport.useMutation({
    onSuccess: result => {
      if (result.updated) toast.success(`Email записан в договоров: ${result.updated}`);
      if (result.failed.length) toast.error(`Не удалось обновить: ${result.failed.length}. ${result.failed[0].message}`);
      utils.contracts.list.invalidate();
      utils.accruals.invalidate();
      close();
    },
    onError: error => toast.error(error.message),
  });
  const close = () => {
    setPlan(null);
    setDataUrl(null);
    setSelected(new Set());
    setShowUnmatched(false);
  };
  const run = (url: string, replace: boolean) => preview.mutate({ dataUrl: url, overwrite: replace });
  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) return toast.error("Нужен файл Excel .xlsx");
    try {
      const url = await readAsDataUrl(file);
      setDataUrl(url);
      setFileName(file.name);
      run(url, overwrite);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось прочитать файл");
    }
  };
  const chosen = useMemo(() => (plan?.changes ?? []).filter(change => selected.has(change.contractId)), [plan, selected]);
  const toggle = (id: number) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChecked = Boolean(plan?.changes.length) && chosen.length === plan?.changes.length;

  return (
    <>
      <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onFile} aria-label="Файл Excel с адресами" />
      <Button variant="outline" className="h-10 rounded-full px-4" onClick={() => inputRef.current?.click()} disabled={preview.isPending}>
        <Mail className="h-4 w-4" />
        {preview.isPending && !plan ? "Читаем адреса…" : "Email из Excel"}
      </Button>
      {plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#18202d]/60 p-4" role="dialog" aria-modal="true" aria-label="Email из Excel">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-base font-semibold text-slate-900">Email из Excel</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {fileName} · строк с адресами: {plan.rowsRead}
                </p>
              </div>
              <Button size="icon" variant="ghost" aria-label="Закрыть" onClick={close}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-100 bg-slate-50 px-5 py-3 text-sm">
              <span>
                Будет записано: <strong>{chosen.length}</strong> из {plan.changes.length}
              </span>
              <span className="text-slate-500">уже совпадает: {plan.unchanged}</span>
              {!overwrite && plan.keptExisting > 0 && <span className="text-slate-500">уже есть другой адрес: {plan.keptExisting}</span>}
              <span className="text-slate-500">не найдено в договорах: {plan.unmatchedCount}</span>
              {plan.ambiguous.length > 0 && <span className="text-amber-700">однофамильцы: {plan.ambiguous.length}</span>}
              <label className="ml-auto flex items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={overwrite}
                  disabled={preview.isPending}
                  onChange={event => {
                    setOverwrite(event.target.checked);
                    if (dataUrl) run(dataUrl, event.target.checked);
                  }}
                />
                Заменять уже заполненные адреса
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {plan.changes.length ? (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-white text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_#e2e8f0]">
                    <tr>
                      <th className="w-10 px-4 py-2">
                        <input type="checkbox" aria-label="Выбрать все" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(plan.changes.map(change => change.contractId)))} />
                      </th>
                      <th className="px-3 py-2">Договор</th>
                      <th className="px-3 py-2">Плательщик</th>
                      <th className="px-3 py-2">Было</th>
                      <th className="px-3 py-2">Станет</th>
                      <th className="px-3 py-2">Найдено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.changes.map(change => (
                      <tr key={change.contractId} className={"border-b border-slate-100 " + (change.review || change.conflict ? "bg-amber-50" : "")}>
                        <td className="px-4 py-2">
                          <input type="checkbox" aria-label={`Записать email для ${change.tenantName}`} checked={selected.has(change.contractId)} onChange={() => toggle(change.contractId)} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {change.contractNumber || "—"}
                          {change.block && <div className="text-xs text-slate-400">Блок {change.block}</div>}
                        </td>
                        <td className="px-3 py-2">{change.tenantName}</td>
                        <td className="px-3 py-2 text-slate-400">{change.oldEmail || "—"}</td>
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {change.newEmail}
                          {change.conflict && <div className="text-xs font-normal text-amber-700">{change.conflict}</div>}
                          {change.review && <div className="text-xs font-normal text-amber-700">{change.review}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {MATCHED_BY[change.matchedBy]}
                          {change.sourceName && change.sourceName !== change.tenantName && <div className="text-slate-400">в файле: {change.sourceName}</div>}
                          <div className="text-slate-400">{change.source}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-5 py-10 text-center text-sm text-slate-500">
                  Нечего записывать: {plan.keptExisting ? "у найденных договоров уже есть адреса — включите «Заменять уже заполненные адреса»." : "адреса из файла уже записаны или договоры не найдены."}
                </p>
              )}
              {(plan.unmatchedCount > 0 || plan.ambiguous.length > 0) && (
                <div className="border-t border-slate-200 px-5 py-3 text-sm">
                  <button type="button" className="font-medium text-[#8a682d]" onClick={() => setShowUnmatched(value => !value)}>
                    {showUnmatched ? "Скрыть" : "Показать"} строки без договора ({plan.unmatchedCount}){plan.ambiguous.length ? ` и однофамильцев (${plan.ambiguous.length})` : ""}
                  </button>
                  {showUnmatched && (
                    <ul className="mt-2 space-y-1 text-xs text-slate-600">
                      {plan.ambiguous.map(row => (
                        <li key={`a${row.sheet}${row.row}`} className="text-amber-700">
                          {row.name} — {row.email}: несколько договоров с таким ФИО в разных квартирах, впишите вручную ({row.sheet}, строка {row.row})
                        </li>
                      ))}
                      {plan.unmatched.map(row => (
                        <li key={`u${row.sheet}${row.row}`}>
                          {row.name || "—"} — {row.email}
                          {row.contractNumber ? ` · ${row.contractNumber}` : ""}
                          {row.block ? ` · блок ${row.block}` : ""}
                          {row.unit ? `, кв. ${row.unit}` : ""} ({row.sheet}, строка {row.row})
                        </li>
                      ))}
                      {plan.unmatchedCount > plan.unmatched.length && <li>… и ещё {plan.unmatchedCount - plan.unmatched.length}</li>}
                    </ul>
                  )}
                </div>
              )}
            </div>
            {(plan.listedWithoutEmail.length > 0 || plan.notInFile.length > 0) && (
              <details className="border-t border-slate-200 px-5 py-3 text-sm">
                <summary className="cursor-pointer font-medium text-slate-800">
                  Почему у договоров останется пустой email: {plan.listedWithoutEmail.length + plan.notInFile.length}
                </summary>
                {plan.listedWithoutEmail.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-slate-600">Есть в файле, но в столбце E-mail пусто ({plan.listedWithoutEmail.length}):</p>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {plan.listedWithoutEmail.map(item => (
                        <li key={`l${item.contractId}`}>
                          {item.contractNumber || "без номера"} — {item.tenantName} ({item.source})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {plan.notInFile.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-slate-600">Не найдены в файле ни по номеру договора, ни по ФИО, ни по блоку и квартире ({plan.notInFile.length}):</p>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {plan.notInFile.map(item => (
                        <li key={`n${item.contractId}`}>
                          {item.contractNumber || "без номера"} — {item.tenantName}
                          {item.block ? ` · блок ${item.block}` : " · блок не определён"}
                          {item.unit ? `, кв. ${item.unit}` : ", квартира не указана"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </details>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
              <span className="text-xs text-slate-500">Останутся без email: {Math.max(0, plan.withoutEmail)}</span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={close}>
                  Отмена
                </Button>
                <Button disabled={!chosen.length || apply.isPending || preview.isPending} onClick={() => apply.mutate({ changes: chosen.map(change => ({ contractId: change.contractId, email: change.newEmail })) })}>
                  {apply.isPending ? "Записываем…" : `Записать email (${chosen.length})`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
