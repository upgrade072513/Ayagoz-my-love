import { describe, expect, it } from "vitest";
import { parseContractText } from "./localOcr";

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
      contractNumber: "0294-2026/08-23", contractDate: "2026-07-07", tenantName: "Асылбек Нұрқали Асылбекұлы",
      tenantContact: "+77472415362", tenantEmail: "nurkali.assylbek@nu.edu.kz", propertyName: "г. Астана, пр. Кабанбай батыра 53, Блок 38",
      unitName: "510", startDate: "2026-09-01", endDate: "2027-06-30", tariffType: "monthly", tariffAmount: 162400,
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
      contractNumber: "0554-2026/08-23", contractDate: "2026-09-04", tenantName: "Haixi Jiang", unitName: "1011",
      startDate: "2026-09-01", endDate: "2026-09-19", tariffType: "daily", tariffAmount: 6960, tenantContact: "+77015551234",
    });
  });

  it("never invents values it cannot find", () => {
    const result = parseContractText("Нечитаемый скан без реквизитов");
    expect(result.tenantName).toBeNull();
    expect(result.tariffAmount).toBeNull();
    expect(result.warnings.join(" ")).toContain("заполните вручную");
  });
});
