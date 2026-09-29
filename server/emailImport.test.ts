import { describe, expect, it } from "vitest";
import { contractKey, extractEmailRows, nameKey, planEmailUpdate } from "./emailImport";

// Shape of «Renters по месяцам — авто.xlsx»: title rows, a summary, then the residents table per block.
const sheet = {
  name: "Сентябрь 2026",
  matrix: [
    ["Проживающие — Сентябрь 2026"],
    ["Блок", null, "Renter — физ. лица"],
    ["№", "Блок", "Квартира", "Категория квартиры", "ФИО", "Должность", "Школа", "Type of tenant", "E-mail", "Statement", "Reason", "contract"],
    ["Блок 36 — «Block 36»"],
    [1, 36, 5, "3-bedroom", "ISSAI PE", null, null, "Renter", "ahvarol@nu.edu.kz", "048-2026-08-23 от 23.01.2026", "", "048-2026-08-23 от 23.01.2026|45453"],
    ["Итого блок 36", null, null, null, 1],
    [2, 38, 407, "studio", "Mr. Muhammad Sabur Ehsan", null, null, "Renter", "sabur@alumni.nu.edu.kz", "", "", ""],
    [3, 38, 512, "studio", "Ms. Nuraiym Kossybak", null, null, "Renter", "nuraiym.kossybak@nu.edu.kz", "", "", ""],
    [4, 39, 1, "studio", "Nobody Here", null, null, "Renter", "nobody@nu.edu.kz", "", "", ""],
  ],
};
const contracts = [
  { id: 1, contractNumber: "048-2026/08-23", tenantName: "ISSAI PE", tenantEmail: null, propertyName: "г. Астана, пр. Кабанбай батыра 53, Блок 36", unitName: "5", blockFolder: null },
  { id: 2, contractNumber: "0300-2026/08-23", tenantName: "Muhammad Sabur Ehsan", tenantEmail: "old@mail.ru", propertyName: "Блок 38", unitName: "407", blockFolder: null },
  { id: 3, contractNumber: "0301-2026/08-23", tenantName: "Нұрайым Қосыбақ", tenantEmail: null, propertyName: "г. Астана, пр. Кабанбай батыра 53, Блок 38", unitName: "512", blockFolder: null },
];

describe("mass e-mail import from Excel", () => {
  it("finds the table under title rows and skips totals", () => {
    const rows = extractEmailRows([{ name: "Тарифы", matrix: [["Категория", "Тариф"]] }, sheet]);
    expect(rows.map(row => row.email)).toEqual([
      "ahvarol@nu.edu.kz",
      "sabur@alumni.nu.edu.kz",
      "nuraiym.kossybak@nu.edu.kz",
      "nobody@nu.edu.kz",
    ]);
    expect(rows[0]).toMatchObject({ block: "36", unit: "5", contractNumber: "048-2026-08-23 от 23.01.2026" });
  });

  it("matches by contract number, by name (titles ignored) and by block+apartment", () => {
    const rows = extractEmailRows([sheet]);
    const keep = planEmailUpdate(rows, contracts, { overwrite: false });
    expect(keep.changes.map(c => [c.contractId, c.newEmail, c.matchedBy])).toEqual([
      [1, "ahvarol@nu.edu.kz", "contractNumber"],
      [3, "nuraiym.kossybak@nu.edu.kz", "similarName"],
    ]);
    expect(keep.keptExisting).toBe(1); // contract 2 already has another address
    expect(keep.unmatchedCount).toBe(1);
    const replace = planEmailUpdate(rows, contracts, { overwrite: true });
    expect(replace.changes.find(c => c.contractId === 2)).toMatchObject({ oldEmail: "old@mail.ru", newEmail: "sabur@alumni.nu.edu.kz", matchedBy: "name" });
  });

  it("does not guess between namesakes in different apartments", () => {
    const rows = extractEmailRows([{ name: "s", matrix: [["ФИО", "E-mail"], ["Иванов Иван", "ivanov@nu.edu.kz"]] }]);
    const plan = planEmailUpdate(rows, [
      { id: 10, contractNumber: "1-1", tenantName: "Иванов Иван", tenantEmail: null, propertyName: "Блок 38", unitName: "1", blockFolder: null },
      { id: 11, contractNumber: "1-2", tenantName: "Иван Иванов", tenantEmail: null, propertyName: "Блок 39", unitName: "2", blockFolder: null },
    ], { overwrite: false });
    expect(plan.changes).toHaveLength(0);
    expect(plan.ambiguous).toHaveLength(1);
  });

  it("normalises keys", () => {
    expect(contractKey("00199-2025/08-22 dated 21.10.2025")).toBe(contractKey("00199-2025/08-22"));
    expect(nameKey("Mr. Bright Egbo")).toBe(nameKey("Egbo Bright"));
    expect(contractKey("0224-2026-08-23 от 04.06.2026")).toBe(contractKey("224-2026/8-23"));
    expect(contractKey("0112- 2026/08-23 от 05.02.2026")).toBe(contractKey("0112-2026/08-23"));
    expect(contractKey("Nazarbayev Fund 022-2026/08-23 от 16.01.2026")).toBe(contractKey("022-2026/08-23"));
    expect(contractKey("№ 0571-2026-08-23 от 16.09.2026")).toBe(contractKey("0571-2026/08-23"));
  });

  it("explains every contract that stays without an address", () => {
    const rows = extractEmailRows([
      {
        name: "s",
        matrix: [
          ["№", "Блок", "Квартира", "ФИО", "E-mail", "Statement"],
          [1, 39, 308, "Ogwumeh Chukwuwike Mike", "", "374-2026 from 01.08.2026"],
          [2, 39, 908, "Абдырахманкызы Наргиза", "nargiza@nu.edu.kz", "0377-2026/08-23 от 01.08.2026"],
          ["Итого блок 39", null, null, 2],
        ],
      },
    ]);
    const plan = planEmailUpdate(
      rows,
      [
        { id: 1, contractNumber: "374-2026", tenantName: "Ogwumeh Chukwuwike Mike", tenantEmail: null, propertyName: "Блок 39", unitName: "308", blockFolder: null },
        { id: 2, contractNumber: "377-2026", tenantName: "Abdyrakhmankyzy Nargiza", tenantEmail: null, propertyName: "Блок 39", unitName: "908", blockFolder: null },
        { id: 3, contractNumber: "999-2026", tenantName: "Кто-то Другой", tenantEmail: null, propertyName: "Блок 40", unitName: "1", blockFolder: null },
      ],
      { overwrite: false }
    );
    // «0377-2026/08-23» in the file = «377-2026» in the app
    expect(plan.changes.map(c => [c.contractId, c.newEmail])).toEqual([[2, "nargiza@nu.edu.kz"]]);
    expect(plan.listedWithoutEmail.map(i => i.contractId)).toEqual([1]);
    expect(plan.notInFile.map(i => i.contractId)).toEqual([3]);
  });

  it("matches Cyrillic and Latin spellings of the same name", async () => {
    const { similarNames } = await import("./emailImport");
    expect(similarNames("Ms. Nuraiym Kossybak", "Нұрайым Қосыбақ")).toBe(true);
    expect(similarNames("Abdyrakhmankyzy Nargiza", "Абдырахманкызы Наргиза")).toBe(true);
    expect(similarNames("Aizhan Serikova", "Айгерим Серикова")).toBe(false);
    expect(similarNames("Mr. s Nancy L Stitt", "Nancy Lee Stitt")).toBe(true);
  });
});
