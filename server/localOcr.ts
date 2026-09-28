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
type Worker = Awaited<
  ReturnType<(typeof import("tesseract.js"))["createWorker"]>
>;

const require = createRequire(import.meta.url);
const LANGS = ["rus", "kaz", "eng"] as const;
const MAX_PAGES = 3; // first two pages (parties, subject, price) + the last one (requisites)
const RENDER_SCALE = 2.2; // ≈ 160–200 dpi for A4, a good trade-off between accuracy and speed

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Copies the bundled *.traineddata.gz into one folder, because Tesseract needs all languages side by side. */
async function prepareLanguageData() {
  const dir = path.join(
    process.env.STORAGE_DIR ||
      process.env.RAILWAY_VOLUME_MOUNT_PATH ||
      os.tmpdir(),
    "tessdata"
  );
  await mkdir(dir, { recursive: true });
  for (const lang of LANGS) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    const exists = await stat(target)
      .then(info => info.size > 0)
      .catch(() => false);
    if (exists) continue;
    const pkgDir = path.dirname(
      require.resolve(`@tesseract.js-data/${lang}/package.json`)
    );
    await copyFile(
      path.join(pkgDir, "4.0.0_best_int", `${lang}.traineddata.gz`),
      target
    );
  }
  return dir;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      const langPath = await prepareLanguageData();
      const worker = await createWorker([...LANGS], OEM.LSTM_ONLY, {
        langPath,
        cachePath: langPath,
        gzip: true,
        logger: () => undefined,
      });
      await worker.setParameters({ preserve_interword_spaces: "1" } as any);
      return worker;
    })().catch(error => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

const MAX_QUEUED_JOBS = 12; // recognition is serial; up to ~12 scans may wait (batch uploads from several users)
let queuedJobs = 0;

export class OcrBusyError extends Error {
  constructor() {
    super(
      "Распознавание сейчас занято другими сканами. Попробуйте через минуту."
    );
    this.name = "OcrBusyError";
  }
}

/** One recognition at a time: Tesseract is CPU-heavy. The queue is bounded, so it cannot be flooded. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  if (queuedJobs >= MAX_QUEUED_JOBS) return Promise.reject(new OcrBusyError());
  queuedJobs++;
  const run = queue.then(job, job).finally(() => {
    queuedJobs--;
  });
  queue = run.catch(() => undefined);
  return run;
}

// Pixel limits: a small compressed file must not expand into gigabytes of bitmap (image bomb).
const MAX_SIDE_PX = 10_000;
const MAX_PIXELS = 40_000_000;
const RENDER_MAX_SIDE_PX = 4_000;

/** Reads width/height from PNG or JPEG headers without decoding the image. */
export function imageDimensions(
  bytes: Buffer
): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes.readUInt32BE(12) === 0x49484452)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      )
        return {
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        };
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}

function assertImageSize(bytes: Buffer) {
  const size = imageDimensions(bytes);
  if (!size) throw new Error("Не удалось прочитать изображение");
  if (
    size.width < 1 ||
    size.height < 1 ||
    size.width > MAX_SIDE_PX ||
    size.height > MAX_SIDE_PX ||
    size.width * size.height > MAX_PIXELS
  )
    throw new Error("Изображение слишком большое для распознавания");
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
  const pageIndexes = Array.from(
    new Set([0, 1, total - 1].filter(n => n >= 0 && n < total))
  ).slice(0, MAX_PAGES);
  const texts: string[] = [];
  const confidences: number[] = [];
  let usedOcr = false;
  try {
    for (const index of pageIndexes) {
      const page = doc.loadPage(index);
      try {
        const layerText = String(
          page.toStructuredText("preserve-whitespace").asText() ?? ""
        ).trim();
        if (layerText.replace(/\s/g, "").length > 120) {
          texts.push(layerText);
          confidences.push(0.98);
          continue;
        }
        // Scale is capped so that even a huge page size cannot produce a giant bitmap.
        const [x0, y0, x1, y1] = page.getBounds();
        const longest = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
        const scale = Math.min(RENDER_SCALE, RENDER_MAX_SIDE_PX / longest);
        const pixmap = page.toPixmap(
          mupdf.Matrix.scale(scale, scale),
          mupdf.ColorSpace.DeviceGray,
          false,
          true
        );
        const result = await ocrImage(Buffer.from(pixmap.asPNG()));
        pixmap.destroy?.();
        texts.push(result.text);
        confidences.push(result.confidence);
        usedOcr = true;
        // Enough already? Then skip the remaining pages (each scanned page costs ~5–10 s).
        const soFar = parseContractText(texts.join("\n\n"), 0.9);
        if (
          index !== pageIndexes[pageIndexes.length - 1] &&
          soFar.tenantName &&
          soFar.startDate &&
          soFar.endDate &&
          soFar.tariffAmount &&
          soFar.propertyName &&
          soFar.unitName
        )
          break;
      } finally {
        page.destroy?.();
      }
    }
  } finally {
    doc.destroy?.();
  }
  return {
    text: texts.join("\n\n"),
    confidence: confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0,
    usedOcr,
  };
}

export async function recognizeLocally(input: {
  base64: string;
  mimeType: LocalOcrMime;
}) {
  return serial(async () => {
    const bytes = Buffer.from(input.base64, "base64");
    if (input.mimeType !== "application/pdf") assertImageSize(bytes);
    const read =
      input.mimeType === "application/pdf"
        ? await readPdf(new Uint8Array(bytes))
        : { ...(await ocrImage(bytes)), usedOcr: true };
    return {
      ...parseContractText(read.text, read.confidence),
      rawText: read.text,
      usedOcr: read.usedOcr,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Text → contract fields
// ---------------------------------------------------------------------------------------------
const MONTHS: Record<string, string> = {
  январ: "01",
  феврал: "02",
  март: "03",
  апрел: "04",
  ма: "05",
  июн: "06",
  июл: "07",
  август: "08",
  сентябр: "09",
  октябр: "10",
  ноябр: "11",
  декабр: "12",
  қаңтар: "01",
  ақпан: "02",
  наурыз: "03",
  сәуір: "04",
  мамыр: "05",
  маусым: "06",
  шілде: "07",
  тамыз: "08",
  қыркүйек: "09",
  қазан: "10",
  қараша: "11",
  желтоқсан: "12",
};
const monthNumber = (word: string) => {
  const w = word.toLowerCase();
  const key = Object.keys(MONTHS)
    .sort((a, b) => b.length - a.length)
    .find(k => w.startsWith(k));
  return key ? MONTHS[key] : null;
};
const pad = (n: string) => n.padStart(2, "0");
const isoDate = (d: string, m: string, y: string) => {
  const year = y.length === 2 ? `20${y}` : y;
  const date = `${year}-${pad(m)}-${pad(d)}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== Number(d)
    ? null
    : date;
};
const DATE_NUM =
  /(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{4}|\d{2})(?!\d)/;
const DATE_WORD =
  /«?\s*(\d{1,2})\s*»?\s+([А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]{3,})\s+(\d{4})/;
const EN_MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const DATE_EN =
  /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})|(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})/i;
function parseDate(text: string): string | null {
  const en = text.match(DATE_EN);
  const enIdx = en?.index ?? Infinity;
  if (
    en &&
    enIdx <= (text.match(DATE_NUM)?.index ?? Infinity) &&
    enIdx <= (text.match(DATE_WORD)?.index ?? Infinity)
  ) {
    const month = String(
      EN_MONTHS.indexOf((en[1] ?? en[5]).slice(0, 3).toLowerCase()) + 1
    );
    return isoDate(en[2] ?? en[4], month, en[3] ?? en[6]);
  }
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
const ANY_DATE = new RegExp(
  `${DATE_NUM.source}|${DATE_WORD.source}|${DATE_EN.source}`,
  "giu"
);

const NAME_WORD = "[А-ЯЁӘҒҚҢӨҰҮҺІA-Z][а-яёәғқңөұүһіa-z'’-]+";
const FULL_NAME = new RegExp(`(${NAME_WORD}(?:\\s+${NAME_WORD}){1,3})`, "u");
const ANY_NAME_WORD =
  "(?:[А-ЯЁӘҒҚҢӨҰҮҺІA-Z][а-яёәғқңөұүһіa-z'’-]+|[А-ЯЁӘҒҚҢӨҰҮҺІA-Z]{2,}(?:-[А-ЯЁA-Z]{2,})?)";
const ANY_NAME = `(${ANY_NAME_WORD}(?:\\s+${ANY_NAME_WORD}){1,3})(?![\\p{L}])`;
const TENANT_ROLES =
  "(?:Проживающ\\p{L}*|Заказчик\\p{L}*|Потребител\\p{L}*|Арендатор\\p{L}*|Наниматель\\p{L}*|Студент\\p{L}*|Жилец\\p{L}*|Тұрушы\\p{L}*)";
const NOT_A_NAME =
  /^(Телефон|Должност|Электрон|Заявител|Паспорт|Passport|Частное|Учреждение|University|Service|Management|Исполнитель|Договор|Республик|Товарищество|Именуем|Настоящ|Сторон)/i;

function clean(value: string | null | undefined) {
  const text = (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:«»"]+|[\s,;:«»"]+$/g, "")
    .trim();
  return text || null;
}

function findTenantName(text: string) {
  const flat = text.replace(/\s+/g, " ");
  // «..., и Иванов Иван Иванович, именуемый в дальнейшем «Проживающий»»
  const beforeRole = new RegExp(
    `${FULL_NAME.source}\\s*,?\\s*(?:\\([^)]{0,60}\\)\\s*,?\\s*)?(?:ИИН[^,]{0,20},\\s*)?именуем\\p{L}*\\s+в\\s+дальнейшем\\s*[«"]?\\s*${TENANT_ROLES}`,
    "gu"
  );
  for (const match of Array.from(flat.matchAll(beforeRole))) {
    const name = clean(match[1]);
    if (name && !NOT_A_NAME.test(name))
      return { value: name, confidence: 0.85 };
  }
  // Application for joining the contract: «прошу предоставить, Nancy Lee Stitt (паспорт № …)»
  const applicant = new RegExp(
    `[Пп]рошу\\s+предостав\\p{L}*\\s*[,:]?\\s*${ANY_NAME}`,
    "u"
  );
  const applicantName = clean(flat.match(applicant)?.[1]);
  if (applicantName && !NOT_A_NAME.test(applicantName))
    return { value: applicantName, confidence: 0.85 };
  // «Nancy Lee Stitt (passport № …)» in the act / requisites
  const withPassport = new RegExp(
    `${ANY_NAME}\\s*[,(]\\s*(?:паспорт|passport|удостоверени)`,
    "gu"
  );
  for (const match of Array.from(flat.matchAll(withPassport))) {
    const name = clean(match[1]);
    if (name && !NOT_A_NAME.test(name))
      return { value: name, confidence: 0.75 };
  }
  // Requisites block: «Проживающий: Иванов Иван Иванович»
  const afterRole = new RegExp(
    `${TENANT_ROLES}\\s*[:\\-–]?\\s*(?:ФИО\\s*[:\\-]?\\s*)?${FULL_NAME.source}`,
    "gu"
  );
  for (const match of Array.from(text.matchAll(afterRole))) {
    const name = clean(match[1]);
    if (name && !NOT_A_NAME.test(name) && name.split(" ").length >= 2)
      return { value: name, confidence: 0.7 };
  }
  return { value: null, confidence: 0 };
}

/** The tenant's own details are after the tenant heading in the requisites; the university's come first. */
function tenantSection(text: string) {
  const heads = Array.from(
    text.matchAll(new RegExp(`${TENANT_ROLES}\\s*:?`, "gu"))
  );
  const last = heads[heads.length - 1];
  return last?.index != null ? text.slice(last.index) : "";
}

const PHONE =
  /(?:\+?7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ORG_EMAIL =
  /^(usm|info|office|admin|reception|dorm|housing|noreply|accounting)@/i;
const normalizePhone = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  const local =
    digits.length === 11
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;
  return local ? `+7${local}` : raw.trim();
};

function findMoney(text: string) {
  const flat = text.replace(/\s+/g, " ");
  const priceContext =
    /(стоимост\p{L}*|плат\p{L}*|ставк\p{L}*|тариф\p{L}*|сумм\p{L}*|составляет|fee|rate|price|cost)[^.]{0,120}?(\d{1,3}(?:[  ]?\d{3})+|\d{4,7})(?:[.,](\d{2}))?\s*(?:\([^)]{0,120}\)\s*)?(?:тенге|тг\.?|₸|KZT)/iu;
  const match =
    flat.match(priceContext) ??
    flat.match(
      /(?:^|\s)()(\d{1,3}(?:[  ]\d{3})+|\d{4,7})(?:[.,](\d{2}))?\s*(?:\([^)]{0,120}\)\s*)?(?:тенге|тг\.?|₸|KZT)/i
    );
  if (!match) return { amount: null as number | null, confidence: 0, tail: "" };
  const amount =
    Number(match[2].replace(/[  ]/g, "")) +
    (match[3] ? Number(match[3]) / 100 : 0);
  const tail = flat.slice(
    match.index ?? 0,
    (match.index ?? 0) + match[0].length + 80
  );
  return {
    amount: amount > 0 ? amount : null,
    confidence: match[1] ? 0.8 : 0.55,
    tail,
  };
}

const MISSING_PREFIX = "Не удалось уверенно найти:";
function missingFieldsWarning(
  values: Record<
    "tenantName" | "startDate" | "endDate" | "tariffAmount",
    unknown
  >
) {
  const labels = {
    tenantName: "плательщик",
    startDate: "дата начала",
    endDate: "дата окончания",
    tariffAmount: "ставка",
  } as const;
  const missing = (Object.keys(labels) as (keyof typeof labels)[]).filter(
    key => !values[key]
  );
  return missing.length
    ? `${MISSING_PREFIX} ${missing.map(key => labels[key]).join(", ")} — заполните вручную.`
    : null;
}

/** All NU apartment blocks (38, 39, 44, 45) are on one campus address. */
export const CAMPUS_ADDRESS = "г. Астана, пр. Кабанбай батыра 53";
const CAMPUS_STREET =
  /(?:Кабанба\p{L}*|Kabanba\p{L}*|Ka[GбБb6]a[uнnh][GбБb6]a\p{L}*|К[аa]б[аa]нб[аa]\p{L}*)/iu;

/** Passport / ID details carry their own numbers and dates — they must not be taken for the contract's. */
const stripPersonalIds = (text: string) =>
  text
    .replace(
      /\(\s*(?:паспорт|passport|удостоверени|уд\.\s*личн|ID\b)[^)]{0,120}\)/giu,
      " "
    )
    .replace(
      /(?:паспорт\p{L}*|passport|удостоверени\p{L}*\s+личност\p{L}*)\s*(?:№|N[ºo°e]?|No\.?)?\s*[A-ZА-Я]?\d{6,12}(?:[^.\n]{0,40}?(?:от|выдан\p{L}*|issue\s+date)\s*[\d.\/-]{8,10})?/giu,
      " "
    )
    .replace(/ИИН\s*:?\s*\d{12}/gu, " ");

/** The header date must not be confused with the stay period that follows it. */
const beforePeriod = (zone: string) => {
  const at = zone.search(
    /срок\p{L}*\s+(?:проживан|найм|действ)|период\p{L}*\s+проживан|(?<![\p{L}\d])с\s+«?\d{1,2}/iu
  );
  return at >= 0 ? zone.slice(0, at) : zone;
};

export function parseContractText(rawText: string, ocrConfidence = 0.9) {
  // Bounded input keeps every regex below linear-time in practice (a crafted PDF text layer can be huge).
  rawText = String(rawText ?? "").slice(0, 200_000);
  const text = rawText
    .replace(/\r/g, "")
    .replace(/(^|[\s,(«])т\.\s*(?=[А-ЯЁ])/gu, "$1г. ")
    .replace(/[“”„]/g, '"')
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/(^|[\s,])np\.\s*/gu, "$1пр. ")
    .replace(/(^|[\s,])(?:kn|kв|кb)\.(?=\s*\d)/gu, "$1кв.");
  const flat = stripPersonalIds(text).replace(/\s+/g, " ");
  const fieldConfidence: Record<string, number> = {};
  const warnings: string[] = [];
  const scale = (value: number) =>
    Math.round(Math.min(1, value * Math.max(0.55, ocrConfidence)) * 100) / 100;

  // Number and date: «ДОГОВОР № 0294-2026/08-23 ... от «07» июля 2026 г.»
  const numberMatch =
    flat.match(
      /Договор\p{L}*\s*(?:№|N[ºo°]?|No\.?)\s*([A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9\-\/._]{1,40})/iu
    ) ??
    flat.match(
      /(?<!(?:паспорт\S*|passport|удостоверени\S*)\s*)№\s*([0-9][A-Za-zА-Яа-я0-9\-\/._]{2,40})/iu
    );
  const contractNumber = clean(numberMatch?.[1]?.replace(/[.,;]+$/, ""));
  fieldConfidence.contractNumber = contractNumber ? scale(0.9) : 0;
  const headerZone =
    numberMatch?.index != null
      ? flat.slice(numberMatch.index, numberMatch.index + 400)
      : beforePeriod(flat.slice(0, 600));
  const contractDate =
    parseDate(
      headerZone.replace(/^Договор[^0-9]*[0-9A-Za-zА-Яа-я\-\/._]+/i, "")
    ) ?? parseDate(beforePeriod(flat.slice(0, 800)));
  fieldConfidence.contractDate = contractDate ? scale(0.8) : 0;

  const tenant = findTenantName(text);
  fieldConfidence.tenantName = scale(tenant.confidence);

  const section = tenantSection(text) || text;
  // Only numbers that look like a phone in context — inventory tables are full of long digit runs.
  const phoneLike = (source: string) =>
    Array.from(source.matchAll(PHONE))
      .filter(
        m =>
          m[0].trim().startsWith("+7") ||
          /(тел\p{L}*|phone|моб\p{L}*|сот\p{L}*|cell|контакт\p{L}*|whats\s*app)[^\n]{0,40}$/iu.test(
            source.slice(Math.max(0, (m.index ?? 0) - 60), m.index)
          )
      )
      .map(m => m[0]);
  const phones = phoneLike(section);
  const allPhones = phoneLike(text);
  const phone =
    phones[0] ??
    (allPhones.length > 1 ? allPhones[allPhones.length - 1] : null);
  const tenantContact = phone ? normalizePhone(phone) : null;
  fieldConfidence.tenantContact = tenantContact
    ? scale(phones.length ? 0.8 : 0.5)
    : 0;

  const emails = Array.from(section.matchAll(EMAIL))
    .map(m => m[0])
    .filter(e => !ORG_EMAIL.test(e));
  const allEmails = Array.from(text.matchAll(EMAIL))
    .map(m => m[0])
    .filter(e => !ORG_EMAIL.test(e));
  const tenantEmail =
    (emails[0] ?? allEmails[allEmails.length - 1] ?? null)?.toLowerCase() ??
    null;
  fieldConfidence.tenantEmail = tenantEmail
    ? scale(emails.length ? 0.85 : 0.55)
    : 0;

  // Period: «с 01.09.2026 по 30.06.2027», «срок проживания ... до ...»
  const enPeriod = flat.match(
    new RegExp(
      `(?:period|term)[^.]{0,60}?from\\s+(${DATE_EN.source})\\s+(?:till|to|until|through)\\s+(${DATE_EN.source})`,
      "iu"
    )
  );
  const periodMatch: string[] | null = enPeriod
    ? [enPeriod[0], enPeriod[1], enPeriod[8]]
    : (flat.match(
        new RegExp(
          `(?:срок\\p{L}*|период\\p{L}*|проживан\\p{L}*)[^.]{0,80}?(?<![\\p{L}\\d])с\\s+(.{6,30}?)\\s+(?:по|до)\\s+(.{6,30}?)(?:[.;,)]|\\s+(?:г|год|включ))`,
          "iu"
        )
      ) ??
      flat.match(
        /(?<![\p{L}\d])с\s+(\S.{5,28}?)\s+(?:по|до)\s+(\S.{5,28}?)(?:[.;,)]|\s+г)/iu
      ));
  let startDate = periodMatch ? parseDate(periodMatch[1]) : null;
  let endDate = periodMatch ? parseDate(periodMatch[2]) : null;
  if (!startDate || !endDate) {
    const all = Array.from(flat.matchAll(ANY_DATE))
      .map(m => parseDate(m[0]))
      .filter((d): d is string => Boolean(d) && d !== contractDate);
    const unique = Array.from(new Set(all)).sort();
    if (!startDate && unique.length >= 2) {
      startDate = unique[0];
      warnings.push(
        "Дата начала определена по первой дате в тексте — проверьте"
      );
    }
    if (!endDate && unique.length >= 2) endDate = unique[unique.length - 1];
  }
  fieldConfidence.startDate = startDate ? scale(periodMatch ? 0.85 : 0.45) : 0;
  fieldConfidence.endDate = endDate ? scale(periodMatch ? 0.85 : 0.45) : 0;

  const money = findMoney(text);
  const tariffAmount = money.amount;
  fieldConfidence.tariffAmount = tariffAmount ? scale(money.confidence) : 0;
  const tariffZone = (money.tail || flat).toLowerCase();
  const tariffType = /(сутк|суточ|за\s+день|в\s+день|per\s+day|daily)/.test(
    tariffZone
  )
    ? "daily"
    : /(месяц|ежемесяч|monthly|per\s+month|айына)/.test(tariffZone)
      ? "monthly"
      : /(сутк|суточ)/.test(flat.toLowerCase())
        ? "daily"
        : /(месяц|ежемесяч)/.test(flat.toLowerCase())
          ? "monthly"
          : null;
  fieldConfidence.tariffType = tariffType
    ? scale(
        money.tail && /(сутк|месяц|ежемесяч|день)/.test(tariffZone) ? 0.85 : 0.5
      )
    : 0;

  // Address and room
  // «по адресу: г. Астана, пр. Кабанбай батыра 53, Блок 38, комната № 510.» → address without the room part
  let propertyName: string | null = null;
  const addressHead =
    /(?:по\s+адр\p{L}{2,4}|адрес\s+проживания|адрес\s+объекта|located\s+at)\s*:?\s*/iu;
  const addressAt = flat.search(addressHead);
  if (addressAt >= 0) {
    const rest = flat.slice(addressAt).replace(addressHead, "").slice(0, 200);
    const cuts = [
      rest.search(/[,;]?\s*(?:комнат|квартир|кв\.|помещени|room|бөлме)/iu),
      rest.search(/\.\s+(?=\d+\.\d|[А-ЯЁ]{3,}|$)|;|\.$/u),
      rest.search(/\s*\/\s*(?=[A-Z])/u),
    ].filter(n => n > 0);
    const cut = cuts.length ? Math.min(...cuts) : -1;
    propertyName = clean(cut > 0 ? rest.slice(0, cut) : rest.slice(0, 120));
  }
  const addressMatch = propertyName;
  const blockMatch = flat.match(
    /(?<![\p{L}\d])(?:Блок\p{L}*|Block)\s*[№#]?\s*([A-ZА-Я]?\d{1,3}[A-ZА-Я]?)(?![\p{L}\d])/iu
  );
  // OCR garbles the street name in mixed RU/EN lines («np.KaGauGaii батыра 53») — the campus address is well known.
  const addressZone =
    addressAt >= 0 ? flat.slice(addressAt, addressAt + 400) : "";
  if (addressZone && CAMPUS_STREET.test(addressZone))
    propertyName = blockMatch
      ? `${CAMPUS_ADDRESS}, Блок ${blockMatch[1]}`
      : CAMPUS_ADDRESS;
  if (!propertyName && blockMatch) propertyName = `Блок ${blockMatch[1]}`;
  fieldConfidence.propertyName = propertyName
    ? scale(addressMatch ? 0.75 : 0.5)
    : 0;
  const unitMatch = flat.match(
    /(?:комнат\p{L}*|квартир\p{L}*|(?<![\p{L}\d])кв\.|помещени\p{L}*|room|apt\.?|apartment|бөлме)\s*№?\s*([0-9]{1,5}[A-Za-zА-Яа-я]?(?:[\-\/][0-9A-Za-zА-Яа-я]+)?)/iu
  );
  const unitName = clean(unitMatch?.[1]);
  fieldConfidence.unitName = unitName ? scale(0.8) : 0;

  const status =
    endDate && endDate < new Date().toISOString().slice(0, 10)
      ? "ended"
      : "active";
  fieldConfidence.status = 0.5;

  const found = Object.entries(fieldConfidence).filter(
    ([key, value]) => key !== "status" && value > 0
  );
  const confidence = found.length
    ? Math.round((found.reduce((sum, [, v]) => sum + v, 0) / 11) * 100) / 100
    : 0;
  const missingText = missingFieldsWarning({
    tenantName: tenant.value,
    startDate,
    endDate,
    tariffAmount,
  });
  if (missingText) warnings.push(missingText);
  if (ocrConfidence < 0.6)
    warnings.push(
      "Скан плохого качества: проверьте все поля особенно внимательно."
    );

  return {
    contractNumber,
    contractDate,
    tenantName: tenant.value,
    tenantContact,
    tenantEmail,
    propertyName,
    unitName,
    startDate,
    endDate,
    tariffType: tariffType as "monthly" | "daily" | null,
    tariffAmount,
    status: status as "active" | "ended",
    confidence,
    fieldConfidence,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// File name → number, date, tenant («0531-2026-08-23 от 31.08.2026г. Nancy Lee Stitt аренда 44 блок.pdf»)
// Staff name the scans themselves, so for scanned (not text) PDFs the file name is more reliable than OCR.
// ---------------------------------------------------------------------------------------------
/** «0531-2026-08-23» → «0531-2026/08-23»: a slash cannot be used in file names. */
export const restoreContractNumber = (value: string) =>
  value.replace(/^(\d{3,5}-\d{4})-(\d{2}-\d{2})$/, "$1/$2");

export function identityFromFileName(fileName?: string) {
  const base = String(fileName ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const empty = {
    contractNumber: null as string | null,
    contractDate: null as string | null,
    tenantName: null as string | null,
    block: null as string | null,
  };
  if (!base) return empty;
  const dated = base.match(
    /^(.*?)\s+(?:от|from)\s+(?:(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})|(\d{4})-(\d{1,2})-(\d{1,2}))\s*(?:г\.?|года?)?\s*(.*)$/iu
  );
  const numberPart = dated
    ? dated[1]
    : (base.match(
        /^(?:№\s*)?([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9./_-]*)/u
      )?.[1] ?? "");
  // A contract number always contains digits ("scan.pdf" or "договор.pdf" carry no number).
  const contractNumber = /\d/.test(numberPart) && numberPart.replace(/^№\s*/u, "").trim()
    ? restoreContractNumber(numberPart.replace(/^№\s*/u, "").trim())
    : null;
  const contractDate = dated
    ? dated[2]
      ? isoDate(dated[2], dated[3], dated[4])
      : isoDate(dated[7], dated[6], dated[5])
    : null;
  const rest = dated?.[8] ?? "";
  const block = rest.match(
    /(?<![\p{L}\d])(?:блок\s*(\d{2,3})|(\d{2,3})\s*блок)/iu
  );
  // The name is what is left before words like «аренда», «блок», «кв», numbers.
  const nameRaw =
    rest.split(
      /\s+(?=(?:аренд|найм|проживан|договор|блок|block|кв\.?|комн|доп|ds|\d))/iu
    )[0] ?? "";
  const nameWords = nameRaw
    .split(" ")
    .filter(word => /^[\p{Lu}][\p{L}'’-]*$/u.test(word));
  return {
    contractNumber,
    contractDate,
    tenantName:
      nameWords.length >= 2 && nameWords.length <= 4
        ? nameWords.join(" ")
        : null,
    block: block ? (block[1] ?? block[2]) : null,
  };
}

type ParsedScan = ReturnType<typeof parseContractText>;
const digitsAndLetters = (value: string | null | undefined) =>
  String(value ?? "")
    .replace(/[^\p{L}\d]/gu, "")
    .toLowerCase();

/** Combines what was read from the scan with what the file name says. */
export function mergeWithFileName(
  fields: ParsedScan,
  fileName: string | undefined,
  usedOcr: boolean
): ParsedScan {
  const id = identityFromFileName(fileName);
  const out = {
    ...fields,
    fieldConfidence: { ...fields.fieldConfidence },
    warnings: [...fields.warnings],
  };
  const take = (
    key: "contractNumber" | "contractDate" | "tenantName",
    value: string | null,
    confidence: number
  ) => {
    if (!value) return;
    const current = out[key];
    const agrees =
      current &&
      (digitsAndLetters(current) === digitsAndLetters(value) ||
        // «Кадиржанов Ерасыл Айтуганович» from the scan is fuller than «Кадиржанов Ерасыл» in the file name
        (key === "tenantName" &&
          value
            .toLowerCase()
            .split(/\s+/)
            .every(word => current.toLowerCase().split(/\s+/).includes(word))));
    if (agrees) {
      out.fieldConfidence[key] = Math.max(out.fieldConfidence[key] ?? 0, 0.95);
      return;
    }
    // Text PDFs are exact — keep them; OCR of a scan loses to the name the manager typed.
    if (!current || usedOcr) {
      out[key] = value;
      out.fieldConfidence[key] = confidence;
    }
  };
  take("contractNumber", id.contractNumber, 0.9);
  take("contractDate", id.contractDate, 0.9);
  take("tenantName", id.tenantName, 0.8);
  if (id.block && !out.propertyName) {
    out.propertyName = `${CAMPUS_ADDRESS}, Блок ${id.block}`;
    out.fieldConfidence.propertyName = 0.6;
  }
  if (id.block && out.propertyName && !/Блок/iu.test(out.propertyName))
    out.propertyName = `${out.propertyName}, Блок ${id.block}`;
  const found = Object.entries(out.fieldConfidence).filter(
    ([key, value]) => key !== "status" && value > 0
  );
  out.confidence = found.length
    ? Math.round((found.reduce((sum, [, v]) => sum + v, 0) / 11) * 100) / 100
    : 0;
  out.warnings = out.warnings.filter(w => !w.startsWith(MISSING_PREFIX));
  const missingText = missingFieldsWarning(out);
  if (missingText) out.warnings.push(missingText);
  return out;
}
