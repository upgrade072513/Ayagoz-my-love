// Matching people and contracts across sources: contract numbers written differently,
// names in Latin/Cyrillic, with titles, initials or small typos.

/**
 * Contract number → comparable key: digit groups without leading zeros.
 * «0224-2026-08-23 от 04.06.2026», «0224-2026/08-23», «№ 224-2026/8-23», «0112- 2026/08-23»,
 * «Nazarbayev Fund 022-2026/08-23 от 16.01.2026» → «224-2026-8-23» / «112-2026-8-23» / «22-2026-8-23».
 */
export const contractKey = (value: string | null | undefined) => {
  const head = String(value ?? "")
    .split("|")[0]
    .split(/\s+(?:от|from|dated)\s+/i)[0];
  const match = head.match(/\d{1,6}\s*[-–]\s*\d{4}(?:\s*[-/–]\s*\d{1,2}\s*[-–]\s*\d{1,2})?/);
  if (match)
    return match[0]
      .split(/\D+/)
      .filter(Boolean)
      .map(group => String(Number(group)))
      .join("-");
  const plain = head.toLowerCase().replace(/[^0-9a-zа-яё]/giu, "");
  return /\d/.test(plain) && plain.length >= 3 ? plain : null;
};
/** Only the number part (no «/08-23» suffix): «305-2026» matches «0305-2026/08-23». */
export const shortKey = (key: string | null) =>
  key && /^\d+-\d{4}(-|$)/.test(key) ? key.split("-").slice(0, 2).join("-") : null;

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "phd", "г", "н", "жа", "господин", "госпожа"]);
/** Case, «ё», punctuation, titles («Mr.», «Dr.») and word order do not matter. */
export const nameKey = (value: string | null | undefined) =>
  nameWords(value).sort().join(" ");
const nameWords = (value: string | null | undefined) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(word => word && !TITLES.has(word));

// Cyrillic (Russian + Kazakh) → Latin, then spelling variants folded together, so that
// «Нұрайым Қосыбақ» and «Nuraiym Kossybak» give the same key.
const TRANSLIT: Record<string, string> = {
  а: "a", ә: "a", б: "b", в: "v", г: "g", ғ: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "i",
  к: "k", қ: "k", л: "l", м: "m", н: "n", ң: "n", о: "o", ө: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ұ: "u", ү: "u", ф: "f", х: "h", һ: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y",
  і: "i", ь: "", э: "e", ю: "yu", я: "ya",
};
const foldWord = (word: string) =>
  Array.from(word)
    .map(char => TRANSLIT[char] ?? char)
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/kh/g, "h")
    .replace(/q/g, "k")
    .replace(/w/g, "v")
    .replace(/x/g, "h") // Uzbek Latin: «Axmedova» = «Akhmedova»
    .replace(/j/g, "zh")
    .replace(/dzh/g, "zh")
    .replace(/(yu|iu)/g, "u")
    .replace(/(ya|ia)/g, "a")
    .replace(/[yi]/g, "i")
    .replace(/(.)\1+/g, "$1");
// Initials («Nancy L Stitt») and stray letters are ignored when comparing.
const latinCache = new Map<string, string[]>();
const latinWords = (value: string | null | undefined) => {
  const key = String(value ?? "");
  let words = latinCache.get(key);
  if (!words) {
    words = nameWords(key)
      .map(foldWord)
      .filter(word => word.length > 1);
    if (latinCache.size > 20_000) latinCache.clear();
    latinCache.set(key, words);
  }
  return words;
};

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
const wordsClose = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 4 && levenshtein(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 5)));
/** Two names are the same person if all words of the shorter one (≥ 2 words) have a close pair in the other. */
export function similarNames(left: string, right: string) {
  const a = latinWords(left);
  const b = latinWords(right);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2) return false;
  const used = new Set<number>();
  return short.every(word => {
    const index = long.findIndex((other, i) => !used.has(i) && wordsClose(word, other));
    if (index < 0) return false;
    used.add(index);
    return true;
  });
}


export type DuplicateCandidate = {
  id: number;
  contractNumber: string | null;
  tenantName: string;
  startDate: unknown;
  endDate: unknown;
  terminationDate?: unknown;
};

const day = (value: unknown) => {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.slice(0, 10);
};

/**
 * Possible duplicate contracts: the same contract number twice, or the same person (name compared
 * across Latin/Cyrillic, word order, titles, initials) with stay periods that overlap.
 * A resident's next contract for a later period is not a duplicate.
 */
export function findDuplicateContracts<T extends DuplicateCandidate>(contracts: T[]) {
  const reasons = new Map<number, Set<string>>();
  const mark = (a: T, b: T, reason: (other: T) => string) => {
    if (!reasons.has(a.id)) reasons.set(a.id, new Set());
    if (!reasons.has(b.id)) reasons.set(b.id, new Set());
    reasons.get(a.id)!.add(reason(b));
    reasons.get(b.id)!.add(reason(a));
  };
  const label = (c: T) => (c.contractNumber ? `№ ${c.contractNumber}` : `договор без номера (${c.tenantName})`);
  const byNumber = new Map<string, T[]>();
  for (const contract of contracts) {
    // «0502-2026/08-23» and «502-2026» are the same contract number.
    const full = contractKey(contract.contractNumber);
    const key = shortKey(full) ?? full;
    if (key) byNumber.set(key, [...(byNumber.get(key) ?? []), contract]);
  }
  byNumber.forEach(group => {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        mark(group[i], group[j], other => `тот же номер, что у ${other.tenantName}`);
  });
  const periodOf = (c: T) => {
    const start = day(c.startDate) ?? "0000-00-00";
    const end = day(c.terminationDate) ?? day(c.endDate) ?? "9999-12-31";
    return { start, end: end < start ? start : end };
  };
  // Only pairs that share the start of a (transliterated) name word are compared — fast on thousands of rows.
  const keys = new Map<number, string>();
  const buckets = new Map<string, T[]>();
  for (const contract of contracts) {
    keys.set(contract.id, nameKey(contract.tenantName));
    for (const prefix of new Set(latinWords(contract.tenantName).map(word => word.slice(0, 3))))
      buckets.set(prefix, [...(buckets.get(prefix) ?? []), contract]);
  }
  const compared = new Set<string>();
  buckets.forEach(group => {
    if (group.length > 400) return; // a prefix shared by hundreds of people says nothing
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (compared.has(pair)) continue;
        compared.add(pair);
        const sameName = keys.get(a.id) === keys.get(b.id) || similarNames(a.tenantName, b.tenantName);
        if (!sameName) continue;
        const pa = periodOf(a);
        const pb = periodOf(b);
        if (pa.start <= pb.end && pb.start <= pa.end)
          mark(a, b, other => `${other.tenantName}: ${label(other)}, периоды пересекаются`);
      }
  });
  return reasons;
}
