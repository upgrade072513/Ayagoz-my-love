import { describe, expect, it } from "vitest";
import { calculateAccrual, describeAccrualParts } from "@shared/accrual";
import {
  parseTariffSchedule,
  validateTariffSchedule,
} from "@shared/tariffSchedule";
import { parseContractText } from "./localOcr";

const contract = {
  startDate: "2026-09-01",
  endDate: "2027-06-30",
  tariffType: "monthly" as const,
  tariffAmount: 150000,
  tariffSchedule: JSON.stringify([
    { from: "2026-09-01", to: "2027-01-14", tariffType: "monthly", amount: 150000 },
    { from: "2027-01-15", to: "2027-06-30", tariffType: "monthly", amount: 165000 },
  ]),
};

describe("tariff that changes during the term", () => {
  it("uses the first rate before the change and the second one after it", () => {
    expect(calculateAccrual(contract, "2026-12")).toMatchObject({
      amount: 150000,
      tariffAmount: 150000,
    });
    expect(calculateAccrual(contract, "2027-03")).toMatchObject({
      amount: 165000,
      tariffAmount: 165000,
      quantity: 1,
    });
  });

  it("splits the month of the change by days", () => {
    const result = calculateAccrual(contract, "2027-01")!;
    // 14 days × 150 000/31 + 17 days × 165 000/31
    expect(result.amount).toBeCloseTo(67741.94 + 90483.87, 2);
    expect(result.parts).toHaveLength(2);
    expect(result.tariffAmount).toBe(165000); // most days
    expect(describeAccrualParts(result.parts)).toContain("01.01–14.01");
  });

  it("days outside the listed periods use the base rate", () => {
    const partial = {
      ...contract,
      tariffSchedule: [
        { from: "2027-02-01", to: "2027-06-30", tariffType: "monthly" as const, amount: 200000 },
      ],
    };
    expect(calculateAccrual(partial, "2026-10")?.amount).toBe(150000);
    expect(calculateAccrual(partial, "2027-02")?.amount).toBe(200000);
  });

  it("rejects overlapping periods and drops garbage", () => {
    expect(
      validateTariffSchedule([
        { from: "2026-09-01", to: "2026-12-31", tariffType: "monthly", amount: 1 },
        { from: "2026-12-01", to: "2027-01-31", tariffType: "monthly", amount: 2 },
      ])
    ).toHaveLength(1);
    expect(parseTariffSchedule("not json")).toEqual([]);
    expect(
      parseTariffSchedule([{ from: "2026-13-01", to: "x", amount: 5 }, { from: "2026-09-01", to: "2026-09-30", amount: "125 000 ₸" }])
    ).toEqual([{ from: "2026-09-01", to: "2026-09-30", tariffType: "monthly", amount: 125000 }]);
  });
});

describe("built-in recognition of a changing rate", () => {
  const cases: Array<[string, number[]]> = [
    [
      "Срок проживания: с 01.09.2026 по 30.06.2027. Стоимость услуг проживания в месяц: с 01.09.2026 по 31.12.2026 – 150 000 (сто пятьдесят тысяч) тенге; с 01.01.2027 по 30.06.2027 – 165 000 тенге. Общая стоимость 1 590 000 тенге.",
      [150000, 165000],
    ],
    [
      "Срок проживания с «1» сентября 2026 г. по «30» июня 2027 г. Плата составляет 120 000 тенге в месяц с 01.09.2026 по 31.12.2026, 130 000 тенге в месяц с 01.01.2027 по 30.06.2027.",
      [120000, 130000],
    ],
    [
      "Accommodation period from September 1, 2026 till June 30, 2027. Accommodation fee per month: from September 1, 2026 to December 31, 2026 - 150 000 KZT, from January 1, 2027 - 170 000 KZT.",
      [150000, 170000],
    ],
    [
      "Срок проживания с «1» сентября 2026 г. по «30» июня 2027 г. Стоимость в месяц: с 1 сентября 2026 г. по 31 декабря 2026 г. – 150 000 тенге, с 1 января 2027 г. по 30 июня 2027 г. – 160 000 тенге.",
      [150000, 160000],
    ],
    [
      // Real NU form (scan 305-2026): first date without a year, period totals + «из расчета … в месяц»
      "Срок проживания: с «01» августа 2026 года по «30» июня 2027 года. Стоимость услуг проживания составляет: с01 августа по 31 октября 2026 года - 417 600 (четыреста семнадцать тысяч шестьсот) тенге с учетом:НДС, из расчета 139 200 (сто тридцать девять тысяч двести) тенге в месяц; “ с 01 ноября 2026 года по 30 июня 2027 года — 1 240 000 (один миллион двести сорок тысяч) тенге с учетом НДС, из расчета 155 000 (сто пятьдесят Пять тысяч) тенге в месяц. Общая стоимость услуг проживания за весь период составляет 1 657 600 тенге",
      [139200, 155000],
    ],
  ];
  it.each(cases)("%s", (text, amounts) => {
    const result = parseContractText(text);
    expect(result.tariffSchedule.map(p => p.amount)).toEqual(amounts);
    if (amounts[0] === 139200) {
      expect(result.tariffSchedule[0]).toMatchObject({ from: "2026-08-01", to: "2026-10-31" });
      expect(result.tariffSchedule[1]).toMatchObject({ from: "2026-11-01", to: "2027-06-30" });
    } else {
      expect(result.tariffSchedule[0]).toMatchObject({ from: "2026-09-01", to: "2026-12-31" });
      expect(result.tariffSchedule[1]).toMatchObject({ from: "2027-01-01", to: "2027-06-30" });
    }
    expect(result.tariffAmount).toBe(amounts[0]);
    expect(result.warnings.join(" ")).toMatch(/Тариф меняется/);
  });
  it("a single rate «из расчета … в месяц» beats the total for the period", () => {
    const result = parseContractText(
      "Срок проживания: с 01.09.2026 по 30.06.2027. Стоимость услуг проживания составляет 1 500 000 тенге, из расчета 150 000 тенге в месяц."
    );
    expect(result.tariffAmount).toBe(150000);
    expect(result.tariffSchedule).toEqual([]);
  });
  it("one rate for the whole term gives no schedule", () => {
    const result = parseContractText(
      "Срок проживания: с 01.09.2026 по 30.06.2027. Стоимость услуг проживания в месяц: 150 000 тенге."
    );
    expect(result.tariffSchedule).toEqual([]);
    expect(result.tariffAmount).toBe(150000);
  });
});

describe("contract input", async () => {
  const { contractInput } = await import("./routers");
  const base = {
    tenantName: "Иванов Иван",
    propertyName: "Блок 38",
    startDate: "2026-09-01",
    endDate: "2027-06-30",
    tariffType: "monthly" as const,
    tariffAmount: 150000,
  };
  it("accepts a consistent schedule and rejects overlapping periods", () => {
    expect(
      contractInput.safeParse({
        ...base,
        tariffSchedule: [
          { from: "2026-09-01", to: "2026-12-31", tariffType: "monthly", amount: 150000 },
          { from: "2027-01-01", to: "2027-06-30", tariffType: "monthly", amount: 165000 },
        ],
      }).success
    ).toBe(true);
    expect(
      contractInput.safeParse({
        ...base,
        tariffSchedule: [
          { from: "2026-09-01", to: "2027-01-31", tariffType: "monthly", amount: 150000 },
          { from: "2027-01-01", to: "2027-06-30", tariffType: "monthly", amount: 165000 },
        ],
      }).success
    ).toBe(false);
  });
});

describe("NU family-housing application (scans 374 and 377)", async () => {
  const { mergeWithFileName, identityFromFileName } = await import("./localOcr");
  // Real Tesseract output: bullet read as «ec», «с 001», «155.000», garbled «№3%блока».
  const ocr374 = `Заявление о присоединении к договору об оказании услуг проживания
Прошу предоставить мне Ogwumeh Chukwuwike Mike (гр. Республики  Нигерия, Паспорт
NeA12907795 от 05.12.2023 года),                                   Студенту
проживания по закрепленному Жилью №3%блока №308; расположенного по адресу Кабанбай батыра
53, с условиями пользования имуществом
Срок проживания: с «01» августа 2026 года по «30» июня 2027 года.
Стоимость услуг проживания составляет:
® с001 августа по 31 октября 2026 года — 417 600 (четыреста семнадцать тысяч шестьсот)
тенге с учетом НДС, из расчета 139 200 (сто тридцать девять тысяч двести) тенге в
месяц;
ec 01 ноября 2026 года по 30 июня 2027 года — 1 240 000 (один миллион двести сорок
тысяч) тенге с учетом НДС, из расчета 155.000 (сто пятьдесят пять тысяч) тенге в
месяц.
Общая стоимость услуг проживания за весь период составляет 1 657 600 тенге
Заявитель: Ogwumeh Chukwuwike Mike
Подпись:
Телефон сотовый:
Accepted the Housing located at: Kabanbai batyr ave. 53, Block 39, Apartment 408, Astana`;
  it("reads name, block, apartment and both rates", () => {
    const fileName = "374-2026 от 01 08 2026 Ogwumeh Chukwuwike Mike 39 block family.PDF";
    const result = mergeWithFileName(parseContractText(ocr374, 0.6), fileName, true);
    expect(result).toMatchObject({
      contractNumber: "374-2026",
      contractDate: "2026-08-01",
      tenantName: "Ogwumeh Chukwuwike Mike",
      propertyName: "г. Астана, пр. Кабанбай батыра 53, Блок 39",
      unitName: "308",
      startDate: "2026-08-01",
      endDate: "2027-06-30",
      tariffAmount: 139200,
    });
    expect(result.tariffSchedule.map(p => [p.from, p.to, p.amount])).toEqual([
      ["2026-08-01", "2026-10-31", 139200],
      ["2026-11-01", "2027-06-30", 155000],
    ]);
    // Application says 308, the act says 408 — the manager is warned.
    expect(result.warnings.join(" ")).toMatch(/308.*408/);
  });
  it("file names with spaces in the date and an English «block»", () => {
    expect(
      identityFromFileName("377-2026 от 01 08 2026 Abdyrakhmankyzy Nargiza 39 block family.PDF")
    ).toEqual({
      contractNumber: "377-2026",
      contractDate: "2026-08-01",
      tenantName: "Abdyrakhmankyzy Nargiza",
      block: "39",
    });
  });
  it("a passport date is never the contract date", () => {
    const result = parseContractText(
      "Прошу предоставить мне Abdyrakhmankyzy Nargiza (гр. Республики Кыргызстан, Паспорт NeAC2971443 от 05.07.2017 года), Жилью №39 блока №908"
    );
    expect(result.contractDate).not.toBe("2017-07-05");
    expect(result.tenantName).toBe("Abdyrakhmankyzy Nargiza");
    expect(result.unitName).toBe("908");
  });
});
