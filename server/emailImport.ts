// Mass e-mail update from an Excel list (e.g. «Renters по месяцам — авто.xlsx»):
// every sheet is scanned for a header row with an «E-mail» column; rows are matched to contracts
// by contract number («Statement»/«Договор»/«contract» columns), otherwise by the tenant's name
// (block/apartment narrow down namesakes).
import { deriveBlockFolder } from "@shared/contractFolder";

export type EmailSourceRow = {
  sheet: string;
  row: number;
  name: string;
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

export type EmailChange = {
  contractId: number;
  contractNumber: string | null;
  tenantName: string;
  block: string | null;
  oldEmail: string | null;
  newEmail: string;
  matchedBy: "contractNumber" | "name" | "name+apartment" | "apartment";
  source: string;
  conflict?: string;
};

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const text = (value: unknown) =>
  value instanceof Date ? "" : String(value ?? "").replace(/\s+/g, " ").trim();

/** «048-2026/08-23», «048-2026-08-23 от 23.01.2026|45453» → «04820260823». */
export const contractKey = (value: string | null | undefined) => {
  const head = String(value ?? "")
    .split("|")[0]
    .split(/\s+(?:от|from|dated)\s+/i)[0]
    .replace(/^№\s*/, "");
  const key = head.toLowerCase().replace(/[^0-9a-zа-яё]/giu, "");
  return /\d/.test(key) && key.length >= 3 ? key : null;
};

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "г", "н", "жа", "господин", "госпожа"]);
/** Case, «ё», punctuation, titles («Mr.», «Dr.») and word order do not matter. */
export const nameKey = (value: string | null | undefined) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(word => word && !TITLES.has(word))
    .sort()
    .join(" ");

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
    // Several contract-like columns («Statement» and a technical «contract»): use all of them.
    const contractCols = header
      .map((cell, index) => (HEADERS.contract.test(cell) ? index : -1))
      .filter(index => index >= 0);
    const blockCol = column(HEADERS.block);
    const unitCol = column(HEADERS.unit);
    for (let r = headerIndex + 1; r < sheet.matrix.length; r++) {
      const cells = sheet.matrix[r];
      const email = text(cells[emailCol]).match(EMAIL)?.[0]?.toLowerCase();
      if (!email) continue; // section titles, totals, rows without an address
      const contractNumber =
        contractCols.map(index => text(cells[index])).find(value => contractKey(value)) ?? null;
      rows.push({
        sheet: sheet.name,
        row: r + 1,
        name: nameCol >= 0 ? text(cells[nameCol]) : "",
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

export function planEmailUpdate(
  source: EmailSourceRow[],
  contracts: ContractForEmail[],
  options: { overwrite: boolean }
) {
  const byNumber = new Map<string, ContractForEmail[]>();
  const byName = new Map<string, ContractForEmail[]>();
  const byApartment = new Map<string, ContractForEmail[]>();
  for (const contract of contracts) {
    const number = contractKey(contract.contractNumber);
    if (number) byNumber.set(number, [...(byNumber.get(number) ?? []), contract]);
    const name = nameKey(contract.tenantName);
    if (name) byName.set(name, [...(byName.get(name) ?? []), contract]);
    const block = contractBlockNumber(contract);
    const unit = digits(contract.unitName);
    if (block && unit && !contract.archivedAt)
      byApartment.set(`${block}|${unit}`, [...(byApartment.get(`${block}|${unit}`) ?? []), contract]);
  }
  const planned = new Map<number, EmailChange>();
  const unmatched: EmailSourceRow[] = [];
  const ambiguous: Array<EmailSourceRow & { candidates: number }> = [];
  let unchanged = 0;
  let keptExisting = 0;
  const touched = new Set<number>();

  for (const row of source) {
    let matches: ContractForEmail[] = [];
    let matchedBy: EmailChange["matchedBy"] = "contractNumber";
    const number = contractKey(row.contractNumber);
    if (number) matches = byNumber.get(number) ?? [];
    if (!matches.length && row.name) {
      matchedBy = "name";
      matches = byName.get(nameKey(row.name)) ?? [];
      if (matches.length > 1 && (row.unit || row.block)) {
        const narrowed = matches.filter(
          contract =>
            (!row.unit || digits(contract.unitName) === row.unit) &&
            (!row.block || contractBlockNumber(contract) === row.block)
        );
        if (narrowed.length) {
          matches = narrowed;
          matchedBy = "name+apartment";
        }
      }
      // Namesakes in different apartments: do not guess.
      const people = new Set(
        matches.map(contract => `${contractBlockNumber(contract)}|${digits(contract.unitName)}`)
      );
      if (matches.length > 1 && people.size > 1) {
        ambiguous.push({ ...row, candidates: matches.length });
        continue;
      }
    }
    // Name spelt differently (Latin vs Cyrillic): the only active contract in that block + apartment.
    if (!matches.length && row.block && row.unit) {
      const inApartment = byApartment.get(`${row.block}|${row.unit}`) ?? [];
      if (inApartment.length === 1) {
        matches = inApartment;
        matchedBy = "apartment";
      }
    }
    if (!matches.length) {
      unmatched.push(row);
      continue;
    }
    for (const contract of matches) {
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
      });
    }
  }
  const withoutEmail = contracts.filter(
    contract => !contract.archivedAt && !contract.tenantEmail && !touched.has(contract.id)
  ).length;
  return {
    changes: Array.from(planned.values()),
    unchanged,
    keptExisting,
    unmatched: unmatched.slice(0, 200),
    unmatchedCount: unmatched.length,
    ambiguous: ambiguous.slice(0, 100),
    rowsRead: source.length,
    withoutEmail,
  };
}
