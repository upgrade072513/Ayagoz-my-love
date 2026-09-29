// Mass e-mail update from an Excel list (e.g. «Renters по месяцам — авто.xlsx»):
// every sheet is scanned for a header row with an «E-mail» column; rows are matched to contracts
// by contract number («Statement»/«Договор»/«contract» columns), then by the tenant's name
// (Latin ↔ Cyrillic spelling, titles and word order do not matter), then by block + apartment.
// The preview also explains every contract without an address that could not be filled.
import { deriveBlockFolder } from "@shared/contractFolder";

export type EmailSourceRow = {
  sheet: string;
  row: number;
  name: string;
  /** "" when the list has the person but no address */
  email: string;
  contractNumber: string | null;
  block: string | null;
  unit: string | null;
};

export type ContractForEmail = {
  id: number;
  contractNumber: string | null;
  tenantName: string;
  tenantEmail: string | null;
  propertyName: string;
  unitName: string | null;
  blockFolder: string | null;
  archivedAt?: unknown;
};

export type MatchKind =
  | "contractNumber"
  | "name"
  | "name+apartment"
  | "similarName"
  | "apartment";

export type EmailChange = {
  contractId: number;
  contractNumber: string | null;
  tenantName: string;
  block: string | null;
  oldEmail: string | null;
  newEmail: string;
  matchedBy: MatchKind;
  source: string;
  sourceName: string;
  conflict?: string;
  /** Uncertain match: shown highlighted and left unticked in the preview. */
  review?: string;
};

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const text = (value: unknown) =>
  value instanceof Date ? "" : String(value ?? "").replace(/\s+/g, " ").trim();

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
const shortKey = (key: string | null) =>
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
    .replace(/x/g, "ks")
    .replace(/j/g, "zh")
    .replace(/dzh/g, "zh")
    .replace(/(yu|iu)/g, "u")
    .replace(/(ya|ia)/g, "a")
    .replace(/[yi]/g, "i")
    .replace(/(.)\1+/g, "$1");
// Initials («Nancy L Stitt») and stray letters are ignored when comparing.
const latinWords = (value: string | null | undefined) =>
  nameWords(value)
    .map(foldWord)
    .filter(word => word.length > 1);

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

const digits = (value: unknown) => {
  const match = text(value).match(/\d+/);
  return match ? String(Number(match[0])) : null;
};

const HEADERS = {
  email: /^(e-?mail|электрон\p{L}*\s*(почта|адрес)?|почта|email для сч\p{L}*)$/iu,
  name: /^(фио|ф\.и\.о\.?|full\s*name|name|плательщик|жил(ец|ьцы)|проживающ\p{L}*|арендатор|tenant)$/iu,
  contract: /^(statement|contract|договор|№\s*договора|номер\s*договора|contract\s*(no|number)?)$/iu,
  block: /^(блок|block)$/iu,
  unit: /^(квартира|кв\.?|комната|помещение|apartment|apt\.?|room)$/iu,
};

export function extractEmailRows(
  sheets: Array<{ name: string; matrix: unknown[][] }>
): EmailSourceRow[] {
  const rows: EmailSourceRow[] = [];
  for (const sheet of sheets) {
    const headerIndex = sheet.matrix.findIndex(
      cells =>
        cells.some(cell => HEADERS.email.test(text(cell))) &&
        cells.some(cell => HEADERS.name.test(text(cell)) || HEADERS.contract.test(text(cell)))
    );
    if (headerIndex < 0) continue;
    const header = sheet.matrix[headerIndex].map(text);
    const column = (pattern: RegExp) => header.findIndex(cell => pattern.test(cell));
    const emailCol = column(HEADERS.email);
    const nameCol = column(HEADERS.name);
    // Several contract-like columns («Statement» and a technical «contract»): use the first usable one.
    const contractCols = header
      .map((cell, index) => (HEADERS.contract.test(cell) ? index : -1))
      .filter(index => index >= 0);
    const blockCol = column(HEADERS.block);
    const unitCol = column(HEADERS.unit);
    for (let r = headerIndex + 1; r < sheet.matrix.length; r++) {
      const cells = sheet.matrix[r];
      const name = nameCol >= 0 ? text(cells[nameCol]) : "";
      const email = text(cells[emailCol]).match(EMAIL)?.[0]?.toLowerCase() ?? "";
      const contractNumber =
        contractCols.map(index => text(cells[index])).find(value => contractKey(value)) ?? null;
      // Section titles («Блок 36 — …») and totals («Итого …») are not people.
      // Merged title rows repeat the same text in every column; a «№» column must hold a number.
      const first = text(cells[0]);
      const numbered = /^№$/.test(header[0] ?? "") && nameCol !== 0;
      const isPerson =
        /\p{L}/u.test(name) &&
        !/^итого/iu.test(first) &&
        !(nameCol !== 0 && first === name) &&
        (!numbered || /^\d+$/.test(first.replace(/\.0+$/, "")));
      if (!isPerson && !email) continue;
      if (numbered && !/^\d+$/.test(first.replace(/\.0+$/, "")) && !email) continue;
      if (!email && !(isPerson && (contractNumber || blockCol >= 0))) continue;
      if (!email && !isPerson) continue;
      rows.push({
        sheet: sheet.name,
        row: r + 1,
        name,
        email,
        contractNumber,
        block: blockCol >= 0 ? digits(cells[blockCol]) ?? (text(cells[blockCol]) || null) : null,
        unit: unitCol >= 0 ? digits(cells[unitCol]) : null,
      });
    }
  }
  return rows;
}

const contractBlockNumber = (contract: ContractForEmail) => {
  const folder = deriveBlockFolder(contract.propertyName, contract.unitName, contract.blockFolder);
  return (
    contract.propertyName.match(/Блок\s*№?\s*(\d+)/iu)?.[1] ??
    folder.match(/(\d+)/)?.[1] ??
    null
  );
};

const add = <K, V>(map: Map<K, V[]>, key: K, value: V) =>
  map.set(key, [...(map.get(key) ?? []), value]);

export function planEmailUpdate(
  source: EmailSourceRow[],
  contracts: ContractForEmail[],
  options: { overwrite: boolean }
) {
  const byNumber = new Map<string, ContractForEmail[]>();
  const byShortNumber = new Map<string, ContractForEmail[]>();
  const byName = new Map<string, ContractForEmail[]>();
  const byApartment = new Map<string, ContractForEmail[]>();
  for (const contract of contracts) {
    const number = contractKey(contract.contractNumber);
    if (number) add(byNumber, number, contract);
    const short = shortKey(number);
    if (short) add(byShortNumber, short, contract);
    const name = nameKey(contract.tenantName);
    if (name) add(byName, name, contract);
    const block = contractBlockNumber(contract);
    const unit = digits(contract.unitName);
    if (block && unit && !contract.archivedAt) add(byApartment, `${block}|${unit}`, contract);
  }
  const apartmentOf = (contract: ContractForEmail) =>
    `${contractBlockNumber(contract)}|${digits(contract.unitName)}`;
  const samePlace = (row: EmailSourceRow, contract: ContractForEmail) =>
    (!row.unit || digits(contract.unitName) === row.unit) &&
    (!row.block || contractBlockNumber(contract) === row.block);

  const planned = new Map<number, EmailChange>();
  const unmatched: EmailSourceRow[] = [];
  const ambiguous: Array<EmailSourceRow & { candidates: number }> = [];
  const listedWithoutEmail: Array<{ contractId: number; contractNumber: string | null; tenantName: string; source: string }> = [];
  let unchanged = 0;
  let keptExisting = 0;
  const touched = new Set<number>();

  const find = (row: EmailSourceRow): { matches: ContractForEmail[]; matchedBy: MatchKind } | "ambiguous" => {
    const number = contractKey(row.contractNumber);
    if (number) {
      const exact = byNumber.get(number) ?? [];
      if (exact.length) return { matches: exact, matchedBy: "contractNumber" };
      const short = shortKey(number);
      const loose = short ? (byShortNumber.get(short) ?? []).filter(contract => !row.name || similarNames(row.name, contract.tenantName) || samePlace(row, contract)) : [];
      if (loose.length) return { matches: loose, matchedBy: "contractNumber" };
    }
    if (row.name) {
      let matches = byName.get(nameKey(row.name)) ?? [];
      let matchedBy: MatchKind = "name";
      if (!matches.length) {
        // Latin ↔ Cyrillic, a missing patronymic, one typo.
        matches = contracts.filter(contract => similarNames(row.name, contract.tenantName));
        matchedBy = "similarName";
      }
      if (matches.length > 1 && (row.unit || row.block)) {
        const narrowed = matches.filter(contract => samePlace(row, contract));
        if (narrowed.length) {
          matches = narrowed;
          if (matchedBy === "name") matchedBy = "name+apartment";
        }
      }
      // Namesakes in different apartments: do not guess.
      if (matches.length > 1 && new Set(matches.map(apartmentOf)).size > 1) return "ambiguous";
      if (matches.length) return { matches, matchedBy };
    }
    // The only active contract in that block + apartment.
    if (row.block && row.unit) {
      const inApartment = byApartment.get(`${row.block}|${row.unit}`) ?? [];
      if (inApartment.length === 1) return { matches: inApartment, matchedBy: "apartment" };
    }
    return { matches: [], matchedBy: "name" };
  };

  for (const row of source) {
    const found = find(row);
    if (found === "ambiguous") {
      if (row.email) ambiguous.push({ ...row, candidates: 0 });
      continue;
    }
    const { matches, matchedBy } = found;
    if (!matches.length) {
      if (row.email) unmatched.push(row);
      continue;
    }
    for (const contract of matches) {
      if (!row.email) {
        if (!contract.tenantEmail && !touched.has(contract.id))
          listedWithoutEmail.push({
            contractId: contract.id,
            contractNumber: contract.contractNumber,
            tenantName: contract.tenantName,
            source: `${row.sheet}, строка ${row.row}`,
          });
        continue;
      }
      touched.add(contract.id);
      const current = contract.tenantEmail?.trim().toLowerCase() || null;
      const previous = planned.get(contract.id);
      if (previous) {
        if (previous.newEmail !== row.email && !previous.conflict)
          previous.conflict = `В файле для этого договора есть и другой адрес: ${row.email} (${row.sheet}, строка ${row.row})`;
        continue;
      }
      if (current === row.email) {
        unchanged++;
        continue;
      }
      if (current && !options.overwrite) {
        keptExisting++;
        continue;
      }
      planned.set(contract.id, {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        tenantName: contract.tenantName,
        block: contractBlockNumber(contract),
        oldEmail: contract.tenantEmail || null,
        newEmail: row.email,
        matchedBy,
        source: `${row.sheet}, строка ${row.row}`,
        sourceName: row.name,
        review:
          matchedBy === "apartment"
            ? `Найден только по блоку и квартире: в файле «${row.name || "—"}»`
            : matchedBy === "similarName" && (row.block || row.unit) && !samePlace(row, contract)
              ? `Похожее ФИО «${row.name}», но другой блок/квартира`
              : undefined,
      });
    }
  }
  const listedIds = new Set(listedWithoutEmail.map(item => item.contractId));
  // Contracts still without an address that the file does not mention at all — with the reason shown in the app.
  const notInFile = contracts
    .filter(
      contract =>
        !contract.archivedAt &&
        !String(contract.tenantEmail ?? "").trim() &&
        !touched.has(contract.id) &&
        !listedIds.has(contract.id)
    )
    .map(contract => ({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      tenantName: contract.tenantName,
      block: contractBlockNumber(contract),
      unit: digits(contract.unitName),
    }));
  return {
    changes: Array.from(planned.values()),
    unchanged,
    keptExisting,
    unmatched: unmatched.slice(0, 200),
    unmatchedCount: unmatched.length,
    ambiguous: ambiguous.slice(0, 100),
    rowsRead: source.filter(row => row.email).length,
    listedWithoutEmail: listedWithoutEmail.filter(item => !touched.has(item.contractId)),
    notInFile,
    withoutEmail: notInFile.length + listedWithoutEmail.filter(item => !touched.has(item.contractId)).length,
  };
}
