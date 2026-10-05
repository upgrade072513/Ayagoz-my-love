import { describe, expect, it } from "vitest";
import XLSX from "xlsx-js-style"; // tests only: builds fixture workbooks
import { parseContractsExcel } from "./excelImport";

function workbookBuffer(rows: unknown[][]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Договоры");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseContractsExcel", () => {
  it("parses Russian headers and normalizes dates and tariff type", async () => {
    const result = await parseContractsExcel(
      workbookBuffer([
        [
          "Номер договора",
          "Дата договора",
          "Плательщик",
          "Объект",
          "Дата начала",
          "Дата окончания",
          "Вид тарифа",
          "Ставка",
        ],
        [
          "Д-2026-001",
          "15.07.2026",
          "ТОО Альфа",
          "Дом 1",
          "01.08.2026",
          "31.08.2026",
          "Месячный",
          "100 000",
        ],
      ])
    );
    expect(result.issues).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({
      contractNumber: "Д-2026-001",
      contractDate: "2026-07-15",
      tenantName: "ТОО Альфа",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      tariffType: "monthly",
      tariffAmount: 100000,
    });
  });
  it("reports invalid tariff rows without dropping valid rows", async () => {
    const result = await parseContractsExcel(
      workbookBuffer([
        [
          "tenantName",
          "propertyName",
          "startDate",
          "endDate",
          "tariffType",
          "tariffAmount",
        ],
        ["Good", "Unit", "2026-08-01", "2026-08-31", "daily", 5000],
        ["Bad", "Unit", "2026-08-01", "2026-08-31", "monthly", 0],
      ])
    );
    expect(result.rows).toHaveLength(1);
    expect(result.issues[0]?.row).toBe(3);
  });
  it("fails when required columns are missing", async () => {
    const result = await parseContractsExcel(
      workbookBuffer([
        ["Плательщик", "Объект"],
        ["A", "B"],
      ])
    );
    expect(result.rows).toHaveLength(0);
    expect(result.issues[0]?.message).toContain(
      "Не найдены обязательные колонки"
    );
  });
});

it("rejects malformed and reversed dates", async () => {
  const result = await parseContractsExcel(
    workbookBuffer([
      [
        "tenantName",
        "propertyName",
        "startDate",
        "endDate",
        "tariffType",
        "tariffAmount",
      ],
      ["Bad date", "Unit", "not-a-date", "2026-08-31", "monthly", 1000],
      ["Reversed", "Unit", "2026-09-01", "2026-08-31", "daily", 1000],
    ])
  );
  expect(result.rows).toHaveLength(0);
  expect(result.issues).toHaveLength(2);
  expect(result.issues.map(issue => issue.message).join("; ")).toContain(
    "неверная дата"
  );
  expect(result.issues.map(issue => issue.message).join("; ")).toContain(
    "начало позже окончания"
  );
});
it("parses a legacy sheet using explicit column mapping", async () => {
  const result = await parseContractsExcel(
    workbookBuffer([
      ["Клиент", "Локация", "С", "По", "Начисление", "Цена"],
      ["ТОО Бета", "Корпус 2", "01.08.2026", "31.08.2026", "сутки", "2500"],
    ]),
    {
      tenantName: 0,
      propertyName: 1,
      startDate: 2,
      endDate: 3,
      tariffType: 4,
      tariffAmount: 5,
    }
  );
  expect(result.rows[0]).toMatchObject({
    tenantName: "ТОО Бета",
    propertyName: "Корпус 2",
    tariffType: "daily",
    tariffAmount: 2500,
  });
  expect(result.issues).toHaveLength(0);
});

it("imports a residents table without contracts: period, «Договор» text, rate change from the header", async () => {
    const result = await parseContractsExcel(
      workbookBuffer([
        ["Тип проживания", "Тип квартиры", "Имя", "Период проживания", "Договор", "тариф в тенге c НДС", "тариф с 1 ноября", "общая сумаа проживания с учетом ком услуг"],
        ["PhD Student", "1-bedroom", "Акмарал Балпышева", "07.08.2026 - 31.07.2026", "502-2026 от 07.08.2026 Акмарал Балпышева (аренда 38 блок PHD) Н", 62144, 75000, null],
        ["Family student", "Studio", "Ariza Azam", "26.08.2026 - 31.07.2026", "501-2026 от 26.08.2026 Ariza Azam", 92800, 105000, null],
        ["Renter", "1-bedroom", "Amir Behzad Samii", "10.09.2026 - 24.09.2026", null, 7500, null, 112500],
      ]),
      undefined,
      { fileName: "38 блок таблица с расчетами услуг проживания 1.xlsx" }
    );
    expect(result.issues).toEqual([]);
    const [phd, family, renter] = result.rows;
    expect(phd).toMatchObject({
      contractNumber: "502-2026",
      contractDate: "2026-08-07",
      tenantName: "Акмарал Балпышева",
      propertyName: "г. Астана, пр. Кабанбай батыра 53, Блок 38",
      blockFolder: "PHD Student",
      startDate: "2026-08-07",
      endDate: "2027-07-31", // «31.07.2026» before the start = next year
      tariffType: "monthly",
      tariffAmount: 62144,
      tariffSchedule: [
        { from: "2026-08-07", to: "2026-10-31", tariffType: "monthly", amount: 62144 },
        { from: "2026-11-01", to: "2027-07-31", tariffType: "monthly", amount: 75000 },
      ],
    });
    expect(phd.notes).toMatch(/исправлена на 31\.07\.2027/);
    expect(family).toMatchObject({ blockFolder: "Family Students", propertyName: "г. Астана, пр. Кабанбай батыра 53, Блок 38" });
    // 15 days × 7 500 = 112 500 → daily rate, finished stay
    expect(renter).toMatchObject({ tariffType: "daily", tariffAmount: 7500, status: "ended", endDate: "2026-09-24" });
    expect(renter.tariffSchedule).toBeUndefined();
  });
