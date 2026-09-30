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
    .replace(/x/g, "h") // Uzbek Latin: «Axmedova» = «Akhmedova»
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

  const sameBlock = (row: EmailSourceRow, contract: ContractForEmail) =>
    !row.block || !contractBlockNumber(contract) || contractBlockNumber(contract) === row.block;
  type Hit = { contract: ContractForEmail; kind: MatchKind; review?: string };
  /**
   * Every contract of the person in the row: the one with the number from the file AND the resident's
   * other contracts found by name (the list often cites last year's contract while the app also has a
   * new one — both should get the address).
   */
  const find = (row: EmailSourceRow): Hit[] | "ambiguous" => {
    const hits = new Map<number, Hit>();
    const put = (hit: Hit) => {
      if (!hits.has(hit.contract.id)) hits.set(hit.contract.id, hit);
    };
    const number = contractKey(row.contractNumber);
    if (number) {
      for (const contract of byNumber.get(number) ?? []) put({ contract, kind: "contractNumber" });
      if (!hits.size) {
        const short = shortKey(number);
        for (const contract of short ? byShortNumber.get(short) ?? [] : [])
          if (!row.name || similarNames(row.name, contract.tenantName) || samePlace(row, contract))
            put({ contract, kind: "contractNumber" });
      }
    }
    if (row.name) {
      const exactKey = nameKey(row.name);
      const byNameHits = contracts
        .filter(contract => nameKey(contract.tenantName) === exactKey || similarNames(row.name, contract.tenantName))
        .map(contract => ({ contract, exact: nameKey(contract.tenantName) === exactKey }));
      const hasPlace = Boolean(row.block || row.unit);
      const inPlace = hasPlace ? byNameHits.filter(item => samePlace(row, item.contract)) : [];
      for (const item of inPlace)
        put({ contract: item.contract, kind: item.exact ? (hasPlace ? "name+apartment" : "name") : "similarName" });
      // Same person, but the apartment differs (or is missing) in the app or in the file.
      const candidates = byNameHits.filter(
        item => sameBlock(row, item.contract) && !hits.has(item.contract.id)
      );
      const ambiguousRest =
        candidates.length > 1 && new Set(candidates.map(item => apartmentOf(item.contract))).size > 1;
      if (ambiguousRest && !hits.size) return "ambiguous"; // namesakes in different apartments: do not guess
      if (!ambiguousRest)
        for (const item of candidates)
          put({
            contract: item.contract,
            kind: item.exact ? "name" : "similarName",
            // Only a real contradiction needs a look: the app has another apartment number.
            review:
              row.unit && digits(item.contract.unitName) && digits(item.contract.unitName) !== row.unit
                ? `В файле «${row.name}», блок ${row.block ?? "—"}, кв. ${row.unit}; в договоре кв. ${digits(item.contract.unitName)} — проверьте`
                : undefined,
          });
    }
    return Array.from(hits.values());
  };
  /** Second pass: a row nobody matched ↔ the only untouched active contract in that block + apartment. */
  const rowsPerApartment = new Map<string, number>();
  for (const row of source)
    if (row.block && row.unit)
      rowsPerApartment.set(`${row.block}|${row.unit}`, (rowsPerApartment.get(`${row.block}|${row.unit}`) ?? 0) + 1);
  const findByApartment = (row: EmailSourceRow, taken: Set<number>): Hit[] => {
    if (!row.block || !row.unit) return [];
    const key = `${row.block}|${row.unit}`;
    // Shared apartments (several residents) are never matched by the apartment alone.
    if ((rowsPerApartment.get(key) ?? 0) !== 1) return [];
    const inApartment = (byApartment.get(key) ?? []).filter(contract => !taken.has(contract.id));
    if (inApartment.length !== 1 || (byApartment.get(key) ?? []).length !== 1) return [];
    return [
      {
        contract: inApartment[0],
        kind: "apartment",
        review: `Найден только по блоку и квартире: в файле «${row.name || "—"}»`,
      },
    ];
  };

  const firstPass = source.map(row => ({ row, found: find(row) }));
  const takenFirst = new Set<number>();
  for (const item of firstPass)
    if (item.found !== "ambiguous") for (const hit of item.found) takenFirst.add(hit.contract.id);
  for (const item of firstPass)
    if (item.found !== "ambiguous" && !item.found.length) item.found = findByApartment(item.row, takenFirst);
  for (const { row, found } of firstPass) {
    if (found === "ambiguous") {
      if (row.email) ambiguous.push({ ...row, candidates: 0 });
      continue;
    }
    if (!found.length) {
      if (row.email) unmatched.push(row);
      continue;
    }
    for (const { contract, kind: matchedBy, review } of found) {
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
        review,
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
