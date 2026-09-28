import React, { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type StandaloneImportRow = {
  period: string;
  serviceFrom: string;
  serviceTo: string;
  tenantName: string;
  tenantEmail?: string;
  propertyName: string;
  unitName?: string;
  tariffType: "monthly" | "daily";
  tariffAmount: number;
  quantity: number;
  amount: number;
  notes?: string;
};

type StandaloneParseResult = { rows: StandaloneImportRow[]; errors: string[] };

const asDate = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return new Date(Date.UTC(1899, 11, 30 + value)).toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : text.slice(0, 10);
};
const number = (value: unknown) => {
  const text = String(value ?? "").replace(/[^0-9,.-]/g, "").replace(/,(?=.*[,])/g, "").replace(",", ".");
  return Number(text);
};
const key = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("ru-RU").replace(/[\s_./()–—-]+/g, "");
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const periodEnd = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return Number.isInteger(year) && Number.isInteger(month) ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) : `${period}-28`;
};
const daysInclusive = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

export function parseStandaloneRows(rows: Record<string, unknown>[], period: string, fallback: { tariffType: "monthly" | "daily"; tariffAmount: number }): StandaloneImportRow[] {
  const startOfPeriod = `${period}-01`;
  const endOfPeriod = periodEnd(period);
  let lastBlock = "";
  const parsed = rows.map((row, index) => {
    const values = new Map(Object.entries(row).map(([name, value]) => [key(name), value]));
    const get = (...names: string[]) => names.map(name => values.get(key(name))).find(value => value !== undefined && String(value).trim() !== "");
    const rawBlock = String(get("Block", "Блок", "Объект", "Блок/Объект", "propertyName") || "").trim();
    if (rawBlock) lastBlock = rawBlock;
    const tenantName = String(get("Name, Surname", "Имя, Фамилия", "ФИО", "Плательщик", "ФИО / плательщик", "tenantName") || "").replace(/\s+/g, " ").trim();
    const rawEmail = String(get("e-mail", "email", "Электронная почта", "tenantEmail") || "").replace(/\s+/g, " ").trim();
    const email = isValidEmail(rawEmail) ? rawEmail : "";
    const apartment = String(get("Apartment", "Квартира", "Жилое помещение", "Помещение", "unitName") || "").trim();
    const arrival = asDate(get("Arrival date", "Дата прибытия", "Начало периода", "Начала расчетного периода", "Дата начала", "serviceFrom"));
    const departure = asDate(get("Departure date", "Дата выезда", "Конец периода", "Конец расчетного периода", "Дата окончания", "serviceTo"));
    const serviceFrom = isDate(arrival) ? (arrival > startOfPeriod ? arrival : startOfPeriod) : startOfPeriod;
    const serviceTo = isDate(departure) ? (departure < endOfPeriod ? departure : endOfPeriod) : endOfPeriod;
    const tariffLabel = key(get("Вид тарифа", "Тип тарифа", "tariffType"));
    const tariffType = tariffLabel.includes("суточ") || tariffLabel === "daily" ? "daily" : tariffLabel.includes("месяч") || tariffLabel === "monthly" ? "monthly" : fallback.tariffType;
    const tariffFromFile = number(get("Тариф", "Ставка", "Тариф без НДС", "tariffAmount"));
    const tariffAmount = Number.isFinite(tariffFromFile) && tariffFromFile > 0 ? tariffFromFile : fallback.tariffAmount;
    const quantityFromFile = number(get("Количество дней", "Количество дней расчетного периода", "Количество", "quantity"));
    const quantity = Number.isFinite(quantityFromFile) && quantityFromFile > 0 ? quantityFromFile : tariffType === "daily" && isDate(serviceFrom) && isDate(serviceTo) ? daysInclusive(serviceFrom, serviceTo) : 1;
    const amountFromFile = number(get("Сумма", "Сумма начисления", "Сумма отчета за период (с учетом НДС) в тенге", "Сумма отчета за период без НДС в тенге", "amount"));
    const amount = Number.isFinite(amountFromFile) && amountFromFile > 0 ? amountFromFile : tariffAmount * quantity;
    const id = String(get("ID number NU", "ID", "ИИН") || "").trim();
    const school = String(get("School", "Школа") || "").trim();
    const tenantType = String(get("Type of tenant", "Тип арендатора") || "").trim();
    const reason = String(get("Reason of check-in (reserve)", "Основание", "Комментарий", "Примечание", "notes") || "").trim();
    return { index, period: String(get("Месяц расчета", "Месяц начисления", "Период начисления", "Период", "period") || period).slice(0, 7), serviceFrom, serviceTo, tenantName, tenantEmail: email || undefined, propertyName: rawBlock || lastBlock ? `Блок ${rawBlock || lastBlock}` : "PHD family", unitName: apartment ? `кв. ${apartment}` : undefined, tariffType, tariffAmount, quantity, amount, notes: [id && `ID NU: ${id}`, school, tenantType, reason].filter(Boolean).join(" · ") || undefined };
  }).filter(row => row.tenantName);
  const invalid = parsed.find(row => !row.propertyName || !isDate(row.serviceFrom) || !isDate(row.serviceTo) || row.serviceFrom > row.serviceTo || !Number.isFinite(row.tariffAmount) || row.tariffAmount <= 0 || !Number.isFinite(row.amount) || row.amount <= 0);
  if (invalid) {
    if (!Number.isFinite(fallback.tariffAmount) || fallback.tariffAmount <= 0) throw new Error("В этом файле нет тарифа и суммы. Укажите ставку по умолчанию над кнопкой «Импорт Excel» и повторите загрузку.");
    throw new Error(`Строка ${invalid.index + 2}: не удалось определить период или сумму начисления`);
  }
  if (!parsed.length) throw new Error("В Excel нет строк с ФИО плательщика");
  return parsed.map(({ index: _index, ...row }) => row);
}

export function parseStandaloneRowsWithErrors(rows: Record<string, unknown>[], period: string, fallback: { tariffType: "monthly" | "daily"; tariffAmount: number }): StandaloneParseResult {
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const values = new Map(Object.entries(row).map(([name, value]) => [key(name), value]));
    const get = (...names: string[]) => names.map(name => values.get(key(name))).find(value => value !== undefined && String(value).trim() !== "");
    const tenantName = String(get("Name, Surname", "Имя, Фамилия", "ФИО", "Плательщик", "ФИО / плательщик", "tenantName") || "").replace(/\s+/g, " ").trim();
    const email = String(get("e-mail", "email", "Электронная почта", "tenantEmail") || "").replace(/\s+/g, " ").trim();
    if (!tenantName) errors.push(`Строка ${index + 2}: не найдено ФИО плательщика`);
    else if (email && !isValidEmail(email)) errors.push(`Строка ${index + 2}: некорректный Email «${email}» — строка загружена без Email`);
  });
  try {
    return { rows: parseStandaloneRows(rows, period, fallback), errors };
  } catch (error) {
    return { rows: [], errors: [...errors, error instanceof Error ? error.message : "Не удалось проверить строки Excel"] };
  }
}

export function StandaloneAccrualPanel({ period, onSaved }: { period: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [fallback, setFallback] = useState({ tariffType: "monthly" as "monthly" | "daily", tariffAmount: "" });
  const [importSummary, setImportSummary] = useState<{ ok: boolean; text: string; issues?: string[] } | null>(null);
  const importIssuesRef = useRef<string[]>([]);
  const [form, setForm] = useState({ tenantName: "", tenantEmail: "", propertyName: "", unitName: "", serviceFrom: `${period}-01`, serviceTo: `${period}-01`, tariffType: "monthly" as "monthly" | "daily", tariffAmount: "", quantity: "1", amount: "", notes: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const create = trpc.accruals.createStandalone.useMutation({ onSuccess: () => { toast.success("Начисление без договора создано"); setOpen(false); onSaved(); }, onError: error => toast.error(error.message) });
  const importRows = trpc.accruals.importStandalone.useMutation({ onSuccess: rows => { const issues = importIssuesRef.current; const text = issues.length ? `Успешно загружено строк: ${rows.length}. Предупреждений: ${issues.length}` : `Успешно загружено строк: ${rows.length}`; setImportSummary({ ok: true, text, issues }); toast.success(text); onSaved(); }, onError: error => { const text = `Импорт не выполнен: ${error.message}`; setImportSummary({ ok: false, text, issues: importIssuesRef.current }); toast.error(text); } });
  const readImportFile = trpc.accruals.readImportFile.useMutation();
  const set = (name: string, value: string) => setForm(current => ({ ...current, [name]: value }));
  const submit = () => {
    if (!form.tenantName.trim() || !form.propertyName.trim() || !form.serviceFrom || !form.serviceTo || !form.tariffAmount || !form.quantity || !form.amount) return toast.error("Заполните ФИО, объект, даты, тариф, количество и сумму");
    if (form.serviceFrom > form.serviceTo) return toast.error("Дата окончания не может быть раньше даты начала");
    if ([form.tariffAmount, form.quantity, form.amount].some(value => !Number.isFinite(number(value)) || number(value) <= 0)) return toast.error("Тариф, количество и сумма должны быть больше нуля");
    create.mutate({ ...form, period, tariffAmount: number(form.tariffAmount), quantity: number(form.quantity), amount: number(form.amount), tenantEmail: form.tenantEmail || undefined, unitName: form.unitName || undefined, notes: form.notes || undefined });
  };
  const importExcel = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        // The workbook is parsed on the server with size/row limits (see server/security/spreadsheet.ts).
        const table = await readImportFile.mutateAsync({ dataUrl: String(reader.result) });
        const rows = table.rows.map(cells => Object.fromEntries(table.headers.map((header, index) => [header, cells[index] ?? ""])) as Record<string, unknown>);
        const parsed = parseStandaloneRowsWithErrors(rows, period, { tariffType: fallback.tariffType, tariffAmount: number(fallback.tariffAmount) });
        importIssuesRef.current = parsed.errors;
        if (!parsed.rows.length) { const text = `Импорт не выполнен: ${parsed.errors.join("; ")}`; setImportSummary({ ok: false, text, issues: parsed.errors }); toast.error(text); return; }
        setImportSummary({ ok: true, text: `Проверено строк: ${parsed.rows.length}`, issues: parsed.errors });
        importRows.mutate({ rows: parsed.rows });
      } catch (error) { const text = error instanceof Error ? `Импорт не выполнен: ${error.message}` : "Импорт не выполнен: не удалось прочитать Excel"; setImportSummary({ ok: false, text }); toast.error(text); }
    };
    reader.readAsDataURL(file);
  };
  return <div className="mt-6 border border-[#d9c59b] bg-[#fffaf0] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-[#9a7633]">Дополнительный режим</p><h3 className="mt-1 text-lg font-semibold">Начисления без договора</h3><p className="mt-1 text-sm text-slate-600">Для разовых, legacy и иных начислений без записи в реестре договоров.</p><p className="mt-1 text-xs text-slate-500">PHD_family поддерживается: Name, Surname, e-mail, Block, Apartment, Arrival date, Departure date. Если в файле нет тарифа, укажите ставку ниже.</p></div><div className="flex gap-2"><input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={event => { importExcel(event.target.files?.[0]); event.currentTarget.value = ""; }} /><Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importRows.isPending}>{importRows.isPending ? "Импортируем…" : "Импорт Excel"}</Button><Button onClick={() => setOpen(value => !value)}>{open ? "Закрыть форму" : "Создать без договора"}</Button></div></div>{importSummary && <div role="status" className={`mt-3 text-sm font-medium ${importSummary.ok ? "text-emerald-700" : "text-red-700"}`}><p>{importSummary.text}</p>{importSummary.issues?.length ? <ul className="mt-1 list-disc pl-5 text-xs font-normal text-amber-800">{importSummary.issues.slice(0, 8).map(issue => <li key={issue}>{issue}</li>)}{importSummary.issues.length > 8 && <li>Показаны первые 8 сообщений.</li>}</ul> : null}</div>}<div className="mt-4 grid gap-3 border-t border-[#ead9b5] pt-4 md:grid-cols-3"><div><Label>Вид тарифа для PHD_family</Label><select className="h-10 w-full border border-slate-200 bg-white px-3" value={fallback.tariffType} onChange={event => setFallback(current => ({ ...current, tariffType: event.target.value as "monthly" | "daily" }))}><option value="monthly">Месячный</option><option value="daily">Суточный</option></select></div><div><Label>Ставка по умолчанию, ₸</Label><Input type="number" min="0" step="0.01" value={fallback.tariffAmount} onChange={event => setFallback(current => ({ ...current, tariffAmount: event.target.value }))} placeholder="Нужно, если в Excel нет суммы" /></div><div className="flex items-end text-xs leading-5 text-slate-500">Для месячного тарифа сумма за строку = ставка. Для суточного тарифа сумма = ставка × количество дней периода.</div></div>{open && <div className="mt-5 grid gap-4 border-t border-[#ead9b5] pt-5 md:grid-cols-3"><div><Label>ФИО / плательщик</Label><Input value={form.tenantName} onChange={event => set("tenantName", event.target.value)} /></div><div><Label>Email</Label><Input type="email" value={form.tenantEmail} onChange={event => set("tenantEmail", event.target.value)} /></div><div><Label>Блок / объект</Label><Input value={form.propertyName} onChange={event => set("propertyName", event.target.value)} /></div><div><Label>Помещение</Label><Input value={form.unitName} onChange={event => set("unitName", event.target.value)} /></div><div><Label>Начало периода</Label><Input type="date" value={form.serviceFrom} onChange={event => set("serviceFrom", event.target.value)} /></div><div><Label>Конец периода</Label><Input type="date" value={form.serviceTo} onChange={event => set("serviceTo", event.target.value)} /></div><div><Label>Вид тарифа</Label><select className="h-10 w-full border border-slate-200 bg-white px-3" value={form.tariffType} onChange={event => set("tariffType", event.target.value as "monthly" | "daily")}><option value="monthly">Месячный</option><option value="daily">Суточный</option></select></div><div><Label>Тариф, ₸</Label><Input type="number" min="0" step="0.01" value={form.tariffAmount} onChange={event => set("tariffAmount", event.target.value)} /></div><div><Label>Количество дней / месяцев</Label><Input type="number" min="0" step="0.01" value={form.quantity} onChange={event => set("quantity", event.target.value)} /></div><div><Label>Сумма начисления, ₸</Label><Input type="number" min="0" step="0.01" value={form.amount} onChange={event => set("amount", event.target.value)} /></div><div className="md:col-span-2"><Label>Комментарий / основание</Label><Input value={form.notes} onChange={event => set("notes", event.target.value)} placeholder="Например: разовое начисление за июль" /></div><div className="md:col-span-3 flex items-center justify-between gap-3"><span className="text-sm text-amber-900">Договор: <strong>Без договора</strong></span><Button onClick={submit} disabled={create.isPending}>{create.isPending ? "Сохраняем…" : "Сохранить начисление"}</Button></div></div>}</div>;
}
