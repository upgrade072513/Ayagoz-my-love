// In-house contract recognition: no external AI service, everything runs on our own server.
//  1. PDF with a text layer → the text is read directly (instant and exact).
//  2. Scanned PDF / photo → pages are rendered to images and read with Tesseract OCR
//     (Russian + Kazakh + English language data are bundled in node_modules, nothing is downloaded).
//  3. The text is parsed with rules tuned for NU accommodation contracts (see parseContractText).
import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export type LocalOcrMime = "application/pdf" | "image/jpeg" | "image/png";
type Worker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

const require = createRequire(import.meta.url);
const LANGS = ["rus", "kaz", "eng"] as const;
const MAX_PAGES = 3; // first two pages (parties, subject, price) + the last one (requisites)
const RENDER_SCALE = 2.2; // ≈ 160–200 dpi for A4, a good trade-off between accuracy and speed

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Copies the bundled *.traineddata.gz into one folder, because Tesseract needs all languages side by side. */
async function prepareLanguageData() {
  const dir = path.join(process.env.STORAGE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || os.tmpdir(), "tessdata");
  await mkdir(dir, { recursive: true });
  for (const lang of LANGS) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    const exists = await stat(target).then(info => info.size > 0).catch(() => false);
    if (exists) continue;
    const pkgDir = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    await copyFile(path.join(pkgDir, "4.0.0_best_int", `${lang}.traineddata.gz`), target);
  }
  return dir;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      const langPath = await prepareLanguageData();
      const worker = await createWorker([...LANGS], OEM.LSTM_ONLY, { langPath, cachePath: langPath, gzip: true, logger: () => undefined });
      await worker.setParameters({ preserve_interword_spaces: "1" } as any);
      return worker;
    })().catch(error => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/** One recognition at a time: Tesseract is CPU-heavy, parallel jobs would only slow each other down. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

async function ocrImage(image: Buffer) {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  return { text: data.text ?? "", confidence: (data.confidence ?? 0) / 100 };
}

async function readPdf(bytes: Uint8Array) {
  // MuPDF (WebAssembly): reads the text layer and renders scanned pages to images, no native libraries needed.
  const mupdf: any = await import("mupdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const total = doc.countPages();
  const pageIndexes = Array.from(new Set([0, 1, total - 1].filter(n => n >= 0 && n < total))).slice(0, MAX_PAGES);
  const texts: string[] = [];
  const confidences: number[] = [];
  let usedOcr = false;
  try {
    for (const index of pageIndexes) {
      const page = doc.loadPage(index);
      try {
        const layerText = String(page.toStructuredText("preserve-whitespace").asText() ?? "").trim();
        if (layerText.replace(/\s/g, "").length > 120) {
          texts.push(layerText);
          confidences.push(0.98);
          continue;
        }
        const pixmap = page.toPixmap(mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE), mupdf.ColorSpace.DeviceGray, false, true);
        const result = await ocrImage(Buffer.from(pixmap.asPNG()));
        pixmap.destroy?.();
        texts.push(result.text);
        confidences.push(result.confidence);
        usedOcr = true;
      } finally {
        page.destroy?.();
      }
    }
  } finally {
    doc.destroy?.();
  }
  return { text: texts.join("\n\n"), confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0, usedOcr };
}

export async function recognizeLocally(input: { base64: string; mimeType: LocalOcrMime }) {
  return serial(async () => {
    const bytes = Buffer.from(input.base64, "base64");
    const read = input.mimeType === "application/pdf" ? await readPdf(new Uint8Array(bytes)) : { ...(await ocrImage(bytes)), usedOcr: true };
    return { ...parseContractText(read.text, read.confidence), rawText: read.text, usedOcr: read.usedOcr };
  });
}

// ---------------------------------------------------------------------------------------------
// Text → contract fields
// ---------------------------------------------------------------------------------------------
const MONTHS: Record<string, string> = {
  январ: "01", феврал: "02", март: "03", апрел: "04", ма: "05", июн: "06", июл: "07", август: "08", сентябр: "09", октябр: "10", ноябр: "11", декабр: "12",
  қаңтар: "01", ақпан: "02", наурыз: "03", сәуір: "04", мамыр: "05", маусым: "06", шілде: "07", тамыз: "08", қыркүйек: "09", қазан: "10", қараша: "11", желтоқсан: "12",
};
const monthNumber = (word: string) => {
  const w = word.toLowerCase();
  const key = Object.keys(MONTHS).sort((a, b) => b.length - a.length).find(k => w.startsWith(k));
  return key ? MONTHS[key] : null;
};
const pad = (n: string) => n.padStart(2, "0");
const isoDate = (d: string, m: string, y: string) => {
  const year = y.length === 2 ? `20${y}` : y;
  const date = `${year}-${pad(m)}-${pad(d)}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== Number(d) ? null : date;
};
const DATE_NUM = /(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{4}|\d{2})(?!\d)/;
const DATE_WORD = /«?\s*(\d{1,2})\s*»?\s+([А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]{3,})\s+(\d{4})/;
function parseDate(text: string): string | null {
  const numeric = text.match(DATE_NUM);
  const word = text.match(DATE_WORD);
  const nIdx = numeric?.index ?? Infinity;
  const wIdx = word?.index ?? Infinity;
  if (word && wIdx <= nIdx) {
    const month = monthNumber(word[2]);
    if (month) return isoDate(word[1], month, word[3]);
  }
  if (numeric) return isoDate(numeric[1], numeric[2], numeric[3]);
  return null;
}
const ANY_DATE = new RegExp(`${DATE_NUM.source}|${DATE_WORD.source}`, "gu");

const NAME_WORD = "[А-ЯЁӘҒҚҢӨҰҮҺІA-Z][а-яёәғқңөұүһіa-z'’-]+";
const FULL_NAME = new RegExp(`(${NAME_WORD}(?:\\s+${NAME_WORD}){1,3})`, "u");
const TENANT_ROLES = "(?:Проживающ\\p{L}*|Заказчик\\p{L}*|Потребител\\p{L}*|Арендатор\\p{L}*|Наниматель\\p{L}*|Студент\\p{L}*|Жилец\\p{L}*|Тұрушы\\p{L}*)";
const NOT_A_NAME = /^(Частное|Учреждение|University|Service|Management|Исполнитель|Договор|Республик|Товарищество|Именуем|Настоящ|Сторон)/i;

function clean(value: string | null | undefined) {
  const text = (value ?? "").replace(/\s+/g, " ").replace(/^[\s,.;:«»"]+|[\s,;:«»"]+$/g, "").trim();
  return text || null;
}

function findTenantName(text: string) {
  const flat = text.replace(/\s+/g, " ");
  // «..., и Иванов Иван Иванович, именуемый в дальнейшем «Проживающий»»
  const beforeRole = new RegExp(`${FULL_NAME.source}\\s*,?\\s*(?:\\([^)]{0,60}\\)\\s*,?\\s*)?(?:ИИН[^,]{0,20},\\s*)?именуем\\p{L}*\\s+в\\s+дальнейшем\\s*[«"]?\\s*${TENANT_ROLES}`, "gu");
  for (const match of Array.from(flat.matchAll(beforeRole))) {
    const name = clean(match[1]);
    if (name && !NOT_A_NAME.test(name)) return { value: name, confidence: 0.85 };
  }
  // Requisites block: «Проживающий: Иванов Иван Иванович»
  const afterRole = new RegExp(`${TENANT_ROLES}\\s*[:\\-–]?\\s*(?:ФИО\\s*[:\\-]?\\s*)?${FULL_NAME.source}`, "gu");
  for (const match of Array.from(text.matchAll(afterRole))) {
    const name = clean(match[1]);
    if (name && !NOT_A_NAME.test(name) && name.split(" ").length >= 2) return { value: name, confidence: 0.7 };
  }
  return { value: null, confidence: 0 };
}

/** The tenant's own details are after the tenant heading in the requisites; the university's come first. */
function tenantSection(text: string) {
  const heads = Array.from(text.matchAll(new RegExp(`${TENANT_ROLES}\\s*:?`, "gu")));
  const last = heads[heads.length - 1];
  return last?.index != null ? text.slice(last.index) : "";
}

const PHONE = /(?:\+?7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ORG_EMAIL = /^(usm|info|office|admin|reception|dorm|housing|noreply|accounting)@/i;
const normalizePhone = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 ? digits.slice(1) : digits.length === 10 ? digits : null;
  return local ? `+7${local}` : raw.trim();
};

function findMoney(text: string) {
  const flat = text.replace(/\s+/g, " ");
  const priceContext = /(стоимост\p{L}*|плат\p{L}*|ставк\p{L}*|тариф\p{L}*|сумм\p{L}*|составляет)[^.]{0,120}?(\d{1,3}(?:[  ]?\d{3})+|\d{4,7})(?:[.,](\d{2}))?\s*(?:\([^)]{0,120}\)\s*)?(?:тенге|тг\.?|₸|KZT)/iu;
  const match = flat.match(priceContext) ?? flat.match(/(?:^|\s)()(\d{1,3}(?:[  ]\d{3})+|\d{4,7})(?:[.,](\d{2}))?\s*(?:\([^)]{0,120}\)\s*)?(?:тенге|тг\.?|₸|KZT)/i);
  if (!match) return { amount: null as number | null, confidence: 0, tail: "" };
  const amount = Number(match[2].replace(/[  ]/g, "")) + (match[3] ? Number(match[3]) / 100 : 0);
  const tail = flat.slice((match.index ?? 0), (match.index ?? 0) + match[0].length + 80);
  return { amount: amount > 0 ? amount : null, confidence: match[1] ? 0.8 : 0.55, tail };
}

export function parseContractText(rawText: string, ocrConfidence = 0.9) {
  const text = rawText.replace(/\r/g, "").replace(/(^|[\s,(«])т\.\s*(?=[А-ЯЁ])/gu, "$1г. ").replace(/[“”„]/g, "\"").replace(/[‐‑‒–—]/g, "-");
  const flat = text.replace(/\s+/g, " ");
  const fieldConfidence: Record<string, number> = {};
  const warnings: string[] = [];
  const scale = (value: number) => Math.round(Math.min(1, value * Math.max(0.55, ocrConfidence)) * 100) / 100;

  // Number and date: «ДОГОВОР № 0294-2026/08-23 ... от «07» июля 2026 г.»
  const numberMatch = flat.match(/Договор\p{L}*\s*(?:№|N[ºo°]?|No\.?)\s*([A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9\-\/._]{1,40})/iu) ?? flat.match(/№\s*([0-9][A-Za-zА-Яа-я0-9\-\/._]{2,40})/);
  const contractNumber = clean(numberMatch?.[1]?.replace(/[.,;]+$/, "")) ;
  fieldConfidence.contractNumber = contractNumber ? scale(0.9) : 0;
  const headerZone = numberMatch?.index != null ? flat.slice(numberMatch.index, numberMatch.index + 400) : flat.slice(0, 600);
  const contractDate = parseDate(headerZone.replace(/^Договор[^0-9]*[0-9A-Za-zА-Яа-я\-\/._]+/i, "")) ?? parseDate(flat.slice(0, 800));
  fieldConfidence.contractDate = contractDate ? scale(0.8) : 0;

  const tenant = findTenantName(text);
  fieldConfidence.tenantName = scale(tenant.confidence);

  const section = tenantSection(text) || text;
  const phones = Array.from(section.matchAll(PHONE)).map(m => m[0]);
  const allPhones = Array.from(text.matchAll(PHONE)).map(m => m[0]);
  const phone = phones[0] ?? (allPhones.length > 1 ? allPhones[allPhones.length - 1] : null);
  const tenantContact = phone ? normalizePhone(phone) : null;
  fieldConfidence.tenantContact = tenantContact ? scale(phones.length ? 0.8 : 0.5) : 0;

  const emails = Array.from(section.matchAll(EMAIL)).map(m => m[0]).filter(e => !ORG_EMAIL.test(e));
  const allEmails = Array.from(text.matchAll(EMAIL)).map(m => m[0]).filter(e => !ORG_EMAIL.test(e));
  const tenantEmail = (emails[0] ?? allEmails[allEmails.length - 1] ?? null)?.toLowerCase() ?? null;
  fieldConfidence.tenantEmail = tenantEmail ? scale(emails.length ? 0.85 : 0.55) : 0;

  // Period: «с 01.09.2026 по 30.06.2027», «срок проживания ... до ...»
  const periodMatch = flat.match(new RegExp(`(?:срок\\p{L}*|период\\p{L}*|проживан\\p{L}*)[^.]{0,80}?(?<![\\p{L}\\d])с\\s+(.{6,30}?)\\s+(?:по|до)\\s+(.{6,30}?)(?:[.;,)]|\\s+(?:г|год|включ))`, "iu")) ?? flat.match(/(?<![\p{L}\d])с\s+(\S.{5,28}?)\s+(?:по|до)\s+(\S.{5,28}?)(?:[.;,)]|\s+г)/iu);
  let startDate = periodMatch ? parseDate(periodMatch[1]) : null;
  let endDate = periodMatch ? parseDate(periodMatch[2]) : null;
  if (!startDate || !endDate) {
    const all = Array.from(flat.matchAll(ANY_DATE)).map(m => parseDate(m[0])).filter((d): d is string => Boolean(d) && d !== contractDate);
    const unique = Array.from(new Set(all)).sort();
    if (!startDate && unique.length >= 2) { startDate = unique[0]; warnings.push("Дата начала определена по первой дате в тексте — проверьте"); }
    if (!endDate && unique.length >= 2) endDate = unique[unique.length - 1];
  }
  fieldConfidence.startDate = startDate ? scale(periodMatch ? 0.85 : 0.45) : 0;
  fieldConfidence.endDate = endDate ? scale(periodMatch ? 0.85 : 0.45) : 0;

  const money = findMoney(text);
  const tariffAmount = money.amount;
  fieldConfidence.tariffAmount = tariffAmount ? scale(money.confidence) : 0;
  const tariffZone = (money.tail || flat).toLowerCase();
  const tariffType = /(сутк|суточ|за\s+день|в\s+день|per\s+day|daily)/.test(tariffZone) ? "daily"
    : /(месяц|ежемесяч|monthly|per\s+month|айына)/.test(tariffZone) ? "monthly"
    : /(сутк|суточ)/.test(flat.toLowerCase()) ? "daily" : /(месяц|ежемесяч)/.test(flat.toLowerCase()) ? "monthly" : null;
  fieldConfidence.tariffType = tariffType ? scale(money.tail && /(сутк|месяц|ежемесяч|день)/.test(tariffZone) ? 0.85 : 0.5) : 0;

  // Address and room
  // «по адресу: г. Астана, пр. Кабанбай батыра 53, Блок 38, комната № 510.» → address without the room part
  let propertyName: string | null = null;
  const addressHead = /(?:по\s+адресу|адрес\s+проживания|адрес\s+объекта)\s*:?\s*/iu;
  const addressAt = flat.search(addressHead);
  if (addressAt >= 0) {
    const rest = flat.slice(addressAt).replace(addressHead, "").slice(0, 200);
    const cuts = [rest.search(/[,;]?\s*(?:комнат|квартир|кв\.|помещени|room|бөлме)/iu), rest.search(/\.\s+(?=\d+\.\d|[А-ЯЁ]{3,}|$)|;|\.$/u)].filter(n => n > 0);
    const cut = cuts.length ? Math.min(...cuts) : -1;
    propertyName = clean(cut > 0 ? rest.slice(0, cut) : rest.slice(0, 120));
  }
  const addressMatch = propertyName;
  const blockMatch = flat.match(/(?<![\p{L}\d])Блок\p{L}*\s*[№#]?\s*([A-ZА-Я]?\d{1,3}[A-ZА-Я]?)(?![\p{L}\d])/iu);
  if (!propertyName && blockMatch) propertyName = `Блок ${blockMatch[1]}`;
  fieldConfidence.propertyName = propertyName ? scale(addressMatch ? 0.75 : 0.5) : 0;
  const unitMatch = flat.match(/(?:комнат\p{L}*|квартир\p{L}*|(?<![\p{L}\d])кв\.|помещени\p{L}*|room|бөлме)\s*№?\s*([0-9]{1,5}[A-Za-zА-Яа-я]?(?:[\-\/][0-9A-Za-zА-Яа-я]+)?)/iu);
  const unitName = clean(unitMatch?.[1]);
  fieldConfidence.unitName = unitName ? scale(0.8) : 0;

  const status = endDate && endDate < new Date().toISOString().slice(0, 10) ? "ended" : "active";
  fieldConfidence.status = 0.5;

  const found = Object.entries(fieldConfidence).filter(([key, value]) => key !== "status" && value > 0);
  const confidence = found.length ? Math.round((found.reduce((sum, [, v]) => sum + v, 0) / 11) * 100) / 100 : 0;
  const missing = ["tenantName", "startDate", "endDate", "tariffAmount"].filter(key => !fieldConfidence[key]);
  if (missing.length) warnings.push(`Не удалось уверенно найти: ${missing.map(key => ({ tenantName: "плательщик", startDate: "дата начала", endDate: "дата окончания", tariffAmount: "ставка" } as Record<string, string>)[key]).join(", ")} — заполните вручную.`);
  if (ocrConfidence < 0.6) warnings.push("Скан плохого качества: проверьте все поля особенно внимательно.");

  return {
    contractNumber, contractDate, tenantName: tenant.value, tenantContact, tenantEmail, propertyName, unitName,
    startDate, endDate, tariffType: tariffType as "monthly" | "daily" | null, tariffAmount, status: status as "active" | "ended",
    confidence, fieldConfidence, warnings,
  };
}
