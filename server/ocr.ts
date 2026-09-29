// Contract-scan recognition providers.
// Pick one in Railway → Variables (the first one configured wins):
//   ANTHROPIC_API_KEY  — Claude (console.anthropic.com). API data is not used for training by default.
//   GEMINI_API_KEY     — Google Gemini (aistudio.google.com). Use a paid project for personal data:
//                        on the free tier Google may use requests to improve its products.
// Optional OCR_MODEL overrides the default model of the chosen provider.

export type OcrMime = "application/pdf" | "image/jpeg" | "image/png";
export type OcrProvider = {
  name: "anthropic" | "gemini";
  recognize: (input: {
    base64: string;
    mimeType: OcrMime;
    system: string;
    prompt: string;
  }) => Promise<string>;
};

const TIMEOUT_MS = 90_000;

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 300);
      try {
        message = JSON.parse(text)?.error?.message ?? message;
      } catch {
        /* keep raw text */
      }
      throw new Error(
        `Сервис распознавания ответил ${response.status}: ${message}`
      );
    }
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(
        "Сервис распознавания не ответил вовремя (rate limit / capacity)"
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function anthropicProvider(apiKey: string): OcrProvider {
  const model = process.env.OCR_MODEL?.trim() || "claude-sonnet-4-5";
  return {
    name: "anthropic",
    async recognize({ base64, mimeType, system, prompt }) {
      const file =
        mimeType === "application/pdf"
          ? {
              type: "document",
              source: { type: "base64", media_type: mimeType, data: base64 },
            }
          : {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: base64 },
            };
      const data = await postJson(
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        {
          model,
          max_tokens: 3000,
          temperature: 0,
          system,
          messages: [
            { role: "user", content: [file, { type: "text", text: prompt }] },
          ],
        }
      );
      return (data?.content ?? [])
        .filter((part: any) => part?.type === "text")
        .map((part: any) => part.text)
        .join("");
    },
  };
}

function geminiProvider(apiKey: string): OcrProvider {
  const model = process.env.OCR_MODEL?.trim() || "gemini-2.5-flash";
  return {
    name: "gemini",
    async recognize({ base64, mimeType, system, prompt }) {
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": apiKey },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            {
              role: "user",
              parts: [
                { inline_data: { mime_type: mimeType, data: base64 } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            maxOutputTokens: 3000,
          },
        }
      );
      return (data?.candidates?.[0]?.content?.parts ?? [])
        .map((part: any) => part?.text ?? "")
        .join("");
    },
  };
}

/** The configured provider, or null when automatic recognition is not connected. */
export function getOcrProvider(): OcrProvider | null {
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropic) return anthropicProvider(anthropic);
  const gemini = (
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  )?.trim();
  if (gemini) return geminiProvider(gemini);
  return null;
}

export const OCR_FIELDS_PROMPT = [
  "Извлеки реквизиты договора проживания из приложенного скана и верни ОДИН JSON-объект строго с ключами:",
  "contractNumber (номер договора), contractDate (дата заключения, YYYY-MM-DD), tenantName (плательщик/жилец, ФИО полностью, как в документе, включая отчество),",
  "tenantContact (телефон), tenantEmail, propertyName (адрес объекта), unitName (номер квартиры/комнаты), startDate и endDate (период проживания, YYYY-MM-DD),",
  'tariffType ("monthly" — ставка за месяц, "daily" — за день/сутки), tariffAmount (ставка в тенге, число без пробелов), tariffSchedule (массив, см. ниже), status ("active", "paused" или "ended"),',
  "confidence (0..1), fieldConfidence (объект: для каждого ключа число 0..1), warnings (массив строк на русском о сомнительных полях).",
  "Подсказки по формам Nazarbayev University / University Service Management:",
  "1) «Заявление о присоединении к договору услуг проживания» (или English «Accession statement»): ФИО стоит после слов «прошу предоставить,» / «you are kindly requested to provide», перед «(паспорт…)» / «(passport…)» или «(уд. личности…)».",
  "Период — строка «Срок проживания: с … по …» / «Accommodation period from … till …». Ставка — «Стоимость услуг проживания в месяц/в день …: N тенге» / «Accommodation fee per month/day … N KZT» — это tariffAmount (НЕ «Общая стоимость»/«Total»); «в месяц»/«per month» → monthly, «в день»/«per day» → daily.",
  "2) «Акт приема-передачи»: адрес после «расположенное по адресу:» / «located at:», например «г. Астана, пр. Кабанбай батыра 53, Блок 44, кв. 1003» → propertyName «г. Астана, пр. Кабанбай батыра 53, Блок 44», unitName «1003».",
  "3) Классический договор: номер и дата в шапке «ДОГОВОР № … от …», жилец — сторона «Проживающий/Наниматель/Tenant».",
  "Номер договора в шапке часто вписан от руки — если не уверен, верни null. Паспортные данные и даты паспорта НЕ являются датами договора.",
  "СМЕНА ТАРИФА: если ставка разная для разных частей срока (например «с 01.09.2026 по 31.12.2026 — 150 000 тенге, с 01.01.2027 по 30.06.2027 — 165 000 тенге», «с 1 января 2027 г. стоимость составляет …», таблица периодов со ставками),",
  "заполни tariffSchedule: [{\"from\":\"YYYY-MM-DD\",\"to\":\"YYYY-MM-DD\",\"tariffType\":\"monthly|daily\",\"amount\":число}] — по одному элементу на каждый период, без пропусков и пересечений; если у периода нет даты окончания — to = день перед началом следующего периода или дата окончания договора.",
  "Если у периода указана сумма за весь период И «из расчета N тенге в месяц/в день» — amount = N (ставка), а НЕ сумма за период. Если у первой даты нет года («с 01 августа по 31 октября 2026 года») — год берётся из второй даты.",
  "В этом случае tariffAmount и tariffType — ставка ПЕРВОГО периода. Если ставка одна на весь срок — tariffSchedule: []. Не включай «Общую стоимость», депозит, штрафы.",
  "Неизвестное или нечитаемое поле — null, ничего не придумывай. Верни только JSON без пояснений и без markdown.",
].join(" ");
