import { describe, expect, it } from "vitest";
import { BLOCK_FOLDER_OPTIONS, DEFAULT_BLOCK_FOLDER, deriveBlockFolder } from "@shared/contractFolder";

describe("contract folders", () => {
  it("exposes the approved folder directory", () => {
    expect(BLOCK_FOLDER_OPTIONS).toEqual([
      "Блок А1",
      "Блок А2",
      "Блок А3",
      "Блок А4",
      "ХВ Астана",
      "Старосты",
      "Иные лица студ блоки",
    ]);
  });

  it("classifies obvious folders from imported contract text", () => {
    expect(deriveBlockFolder("Староста 24 блока", "25")).toBe("Старосты");
    expect(deriveBlockFolder("Хайвилл Астана", "39")).toBe("ХВ Астана");
    expect(deriveBlockFolder("Блок А2", "204")).toBe("Блок А2");
  });

  it("maps block numbers, streets and dormitory units to the requested folders", () => {
    expect(deriveBlockFolder("Блок 44", "12")).toBe("Блок А2");
    expect(deriveBlockFolder("Блок 45", "12")).toBe("Блок А4");
    expect(deriveBlockFolder("Жилой блок 39", "12")).toBe("Блок А3");
    expect(deriveBlockFolder("Жилой блок 38", "12")).toBe("Блок А1");
    expect(deriveBlockFolder("ул. Кошкарбаева", "12")).toBe("ХВ Астана");
    expect(deriveBlockFolder("ул. Байтурсынова", "12")).toBe("ХВ Астана");
    expect(deriveBlockFolder("Общежитие", "12")).toBe("Старосты");
    expect(deriveBlockFolder("Жилой корпус", "12D")).toBe("Старосты");
    expect(deriveBlockFolder("Жилой корпус", "D12")).toBe("Старосты");
  });

  it("keeps an explicit folder selection over automatic detection", () => {
    expect(deriveBlockFolder("Хайвилл Астана", "39", "Блок А4")).toBe("Блок А4");
    expect(deriveBlockFolder("", "")).toBe(DEFAULT_BLOCK_FOLDER);
  });
});
