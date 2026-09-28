import { describe, expect, it } from "vitest";
import {
  identityFromFileName,
  mergeWithFileName,
  parseContractText,
} from "./localOcr";

describe("in-house contract text parser", () => {
  it("reads a typical NU accommodation contract", () => {
    const text = `ДОГОВОР № 0294-2026/08-23
возмездного оказания услуг по проживанию
г. Астана «07» июля 2026 г.
Частное учреждение «University Service Management», именуемое в дальнейшем «Исполнитель», в лице директора Сапарова Б.К., действующего на основании Устава, с одной стороны, и Асылбек Нұрқали Асылбекұлы, именуемый в дальнейшем «Проживающий», с другой стороны, заключили настоящий Договор:
1.1. Исполнитель предоставляет место для проживания по адресу: г. Астана, пр. Кабанбай батыра 53, Блок 38, комната № 510.
1.2. Срок проживания: с 01.09.2026 по 30.06.2027.
2.1. Стоимость проживания составляет 162 400 (сто шестьдесят две тысячи четыреста) тенге в месяц.
Исполнитель: ЧУ «University Service Management», тел.: +7 (7172) 70-66-00, e-mail: usm@nu.edu.kz
Проживающий: Асылбек Нұрқали Асылбекұлы, тел.: +7 747 241 53 62, E-mail: nurkali.assylbek@nu.edu.kz`;
    expect(parseContractText(text)).toMatchObject({
      contractNumber: "0294-2026/08-23",
      contractDate: "2026-07-07",
      tenantName: "Асылбек Нұрқали Асылбекұлы",
      tenantContact: "+77472415362",
      tenantEmail: "nurkali.assylbek@nu.edu.kz",
      propertyName: "г. Астана, пр. Кабанбай батыра 53, Блок 38",
      unitName: "510",
      startDate: "2026-09-01",
      endDate: "2027-06-30",
      tariffType: "monthly",
      tariffAmount: 162400,
    });
  });

  it("handles a daily rate, a Latin name and dates written in words", () => {
    const text = `Договор № 0554-2026/08-23 от 04.09.2026
ЧУ «University Service Management» (Исполнитель) и Haixi Jiang, именуемая в дальнейшем «Заказчик», заключили договор.
Адрес проживания: пр. Кабанбай батыра 53, Блок А1, квартира 1011
Период проживания с «1» сентября 2026 г. по «19» сентября 2026 г.
Плата составляет 6 960 тенге за сутки.
Заказчик: Haixi Jiang, +7 (701) 555-12-34, haixi.jiang@nu.edu.kz`;
    expect(parseContractText(text)).toMatchObject({
      contractNumber: "0554-2026/08-23",
      contractDate: "2026-09-04",
      tenantName: "Haixi Jiang",
      unitName: "1011",
      startDate: "2026-09-01",
      endDate: "2026-09-19",
      tariffType: "daily",
      tariffAmount: 6960,
      tenantContact: "+77015551234",
    });
  });

  it("never invents values it cannot find", () => {
    const result = parseContractText("Нечитаемый скан без реквизитов");
    expect(result.tenantName).toBeNull();
    expect(result.tariffAmount).toBeNull();
    expect(result.warnings.join(" ")).toContain("заполните вручную");
  });

  it("reads the scanned application form + acceptance act (bilingual, OCR noise)", () => {
    const text = `ЗАЯВЛЕНИЕ О ПРИСОЕДИНЕНИИ
К ДОГОВОРУ УСЛУГ ПРОЖИВАНИЯ (для физического лица)
т 0%%- 2048/0 ~ £3 -”
Астана                                              « 3 »    6%        2026
В соответствии с Вашим  поручением/решением, прошу предоставить, Jane Ann Doe
(паспорт №А12345678 от 10.08.2023),
Телефоны: раб.                                  , COT.
Срок проживания: с 30 августа 2026 года по 22 сентября 2026 года.
Стоимость услуг проживания в день (с учетом  затрат на коммунальные и
эксплуатационные расходы): 7 500 (семь тысяч пятьсот) тенге с учетом НДС.
Общая стоимость услуг проживания: 180 000 (сто восемьдесят тысяч) тенге с учетом НДС.

АКТ ПРИЕМА-ПЕРЕДАЧИ / ACCEPTANCE AND TRANSFER CERTIFICATE
4   1. Учреждение передало, a Проживающий принял Жилище, расположенное по адресу: г. Астана, np.KaGauGaii батыра 53, Блок 44, kn. 1003 /The
Entity transfered ond a Tenant accepted the Housing located at: Kabanbay Batyr Аус. 53, Block 44, apt. 1003 Astana.
1) количество комнат / number of bedrooms: 1;`;
    const result = parseContractText(text, 0.7);
    expect(result).toMatchObject({
      contractNumber: null,
      contractDate: null,
      tenantName: "Jane Ann Doe",
      propertyName: "г. Астана, пр. Кабанбай батыра 53, Блок 44",
      unitName: "1003",
      startDate: "2026-08-30",
      endDate: "2026-09-22",
      tariffType: "daily",
      tariffAmount: 7500,
    });
    const merged = mergeWithFileName(
      result,
      "0531-2026-08-23 от 31.08.2026г. Jane Ann Doe аренда 44 блок.PDF",
      true
    );
    expect(merged).toMatchObject({
      contractNumber: "0531-2026/08-23",
      contractDate: "2026-08-31",
      tenantName: "Jane Ann Doe",
    });
    expect(merged.warnings.join(" ")).not.toContain("Не удалось");
  });

  it("takes number, date, tenant and block from the file name", () => {
    expect(
      identityFromFileName(
        "0531-2026-08-23 от 31.08.2026г. Nancy Lee Stitt аренда 44 блок.PDF"
      )
    ).toEqual({
      contractNumber: "0531-2026/08-23",
      contractDate: "2026-08-31",
      tenantName: "Nancy Lee Stitt",
      block: "44",
    });
    expect(
      identityFromFileName("№ 0475-2026/08-23 от 01.09.2026.pdf")
    ).toMatchObject({
      contractNumber: "0475-2026/08-23",
      contractDate: "2026-09-01",
      tenantName: null,
    });
    // a text-layer PDF keeps its own exact number
    const parsed = parseContractText(
      "Договор № 0294-2026/08-23 от 07.07.2026",
      0.98
    );
    expect(
      mergeWithFileName(parsed, "0294-2026-08-23 от 07.07.2026.pdf", false)
        .contractNumber
    ).toBe("0294-2026/08-23");
  });

  it("reads the English accession statement and keeps the full name from the scan", () => {
    const text = `ACCESSION STATEMENT
TO THE ACCOMMODATION SERVICES CONTRACT (for person)
No. 024.- 4046/ 07-43
In accordance with your instruction\\decision, you are kindly requested to provide John Peter Smith
(passport Х>Е9410959, issue date 21 02.2017),
Accommodation period from January 01, 2026 till December 30, 2026.
Accommodation fee per month (without utility and operating costs): 127 600 (one hundred twenty seven
thousand six hundred) KZT.
Stul obedenny SD-3 | USM018229   11       2495799)   24957,99
1, Учреждение передало, а Проживающий принял Жилище, расположенное по адрсеу: г. Астаны, np KaGanGat батыра 53, Блок 44, ка. 1004 /The Entity transferred
anda Tenant accepted the Housing located at: Kabanbay Batyr Ave. 53, Block 44, apt. 1004 Astana.`;
    const result = parseContractText(text, 0.7);
    expect(result).toMatchObject({
      tenantName: "John Peter Smith",
      propertyName: "г. Астана, пр. Кабанбай батыра 53, Блок 44",
      unitName: "1004",
      startDate: "2026-01-01",
      endDate: "2026-12-30",
      tariffType: "monthly",
      tariffAmount: 127600,
      tenantContact: null,
      contractDate: null,
    });
    expect(
      mergeWithFileName(
        result,
        "072-2026-08-23 от 28.01.2026г. John Smith аренда 44 блока.pdf",
        true
      ).tenantName
    ).toBe("John Peter Smith");
  });
});
