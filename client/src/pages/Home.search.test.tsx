/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contracts: [] as any[],
  accruals: [] as any[],
  invoices: [] as any[],
  scanPreviewMutate: vi.fn(),
  moveToFolderMutate: vi.fn(),
  documents: [] as any[],
  documentDownloadData: undefined as any,
}));

vi.mock("@/lib/trpc", () => {
  const useMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
  trpc: {
    contracts: {
      list: { useQuery: () => ({ data: mocks.contracts }) },
      audit: { useQuery: () => ({ data: [] }) },
      create: { useMutation },
      update: { useMutation },
      delete: { useMutation },
      restore: { useMutation },
      permanentDeleteEligible: { useQuery: () => ({ data: [] }) },
      permanentlyDelete: { useMutation },
      permanentlyDeleteMany: { useMutation },
      createFromScan: { useMutation },
      previewImport: { useMutation },
      importRows: { useMutation },
      moveToFolder: { useMutation: () => ({ mutate: mocks.moveToFolderMutate, mutateAsync: vi.fn(), isPending: false }) },
      previewScan: { useMutation: () => ({ mutate: mocks.scanPreviewMutate, mutateAsync: vi.fn(), isPending: false }) },
    },
    contractFolders: {
      list: { useQuery: () => ({ data: [{ id: 1, name: "Блок А1" }, { id: 2, name: "Блок А2" }] }) },
      create: { useMutation },
      rename: { useMutation },
      remove: { useMutation },
    },
    documents: {
      list: { useQuery: () => ({ data: mocks.documents }) },
      download: { useQuery: () => ({ data: mocks.documentDownloadData, isLoading: false }) },
      upload: { useMutation },
      delete: { useMutation },
    },
    accruals: {
      list: { useQuery: () => ({ data: mocks.accruals }) },
      generate: { useMutation },
      updateAmount: { useMutation },
      updateEmail: { useMutation },
      remove: { useMutation },
      removeMany: { useMutation },
      clearHistory: { useMutation },
      updateFromPreview: { useMutation },
      createStandalone: { useMutation },
      importStandalone: { useMutation },
      readImportFile: { useMutation },
    },
    invoices: {
      list: { useQuery: () => ({ data: mocks.invoices }) },
      items: { useQuery: () => ({ data: [] }) },
      previewEmail: { useQuery: () => ({ data: undefined, isLoading: false }) },
      markEmailSent: { useMutation },
      bulkCreate: { useMutation },
      create: { useMutation },
      exportExcel: { useMutation },
      previewExcel: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, data: undefined, reset: vi.fn() }) },
    },
    useUtils: () => ({ contracts: { list: { invalidate: vi.fn() } }, contractFolders: { list: { invalidate: vi.fn() } }, documents: { list: { invalidate: vi.fn() } }, invoices: { list: { invalidate: vi.fn() } } }),
  },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { Accruals, ContractForm, Contracts, Invoices, TENANT_CATEGORY_OPTIONS, buildQuickSearchSuggestions, calculateAccrualAmountByPeriod, getScanMimeType, isSupportedScanFile, splitImportRows } from "./Home";

describe("section search wiring", () => {
  afterEach(() => cleanup());

  it("exposes the preset tenant category directory", () => {
    expect(TENANT_CATEGORY_OPTIONS).toEqual(["Сотрудник", "Гость", "Подрядчик", "Арендатор", "Представитель организации", "Другое"]);
  });

  it("splits large contract imports into safe batches", () => {
    const chunks = splitImportRows(Array.from({ length: 205 }, (_, index) => index));
    expect(chunks.map(chunk => chunk.length)).toEqual([100, 100, 5]);
    expect(chunks.flat()).toHaveLength(205);
  });

  it("builds unique quick-search suggestions for tenant, property, contract number, and email", () => {
    const rows = [
      { tenantName: "Анна", propertyName: "Block A", unitName: "101", contractNumber: "Д-001", tenantEmail: "anna@example.com" },
      { tenantName: "Анна", propertyName: "Block A", unitName: "101", contractNumber: "Д-002", tenantEmail: "anna@example.com" },
    ];
    expect(buildQuickSearchSuggestions(rows, "анна").map(item => item.meta)).toEqual(["Арендатор"]);
    expect(buildQuickSearchSuggestions(rows, "example.com").map(item => item.meta)).toEqual(["Email арендатора"]);
    expect(buildQuickSearchSuggestions(rows, "block")[0]).toMatchObject({ label: "Block A", meta: "Объект · 101" });
    expect(buildQuickSearchSuggestions(rows, "д-002")[0]).toMatchObject({ label: "Д-002", meta: "Номер договора" });
  });

  beforeEach(() => {
    mocks.contracts = [
      { id: 1, contractNumber: "Д-001", contractDate: "2026-07-15", tenantName: "Анна", tenantContact: "A1", tenantEmail: "anna@example.com", propertyName: "Block A", unitName: "101", tariffType: "daily", tariffAmount: "100", status: "active", startDate: "2026-08-01", endDate: "2026-08-31" },
      { id: 2, contractNumber: "Д-002", contractDate: "2026-06-20", tenantName: "Борис", tenantContact: "B2", tenantEmail: "boris@example.com", propertyName: "Block B", unitName: "202", tariffType: "monthly", tariffAmount: "200", status: "ended", startDate: "2026-08-01", endDate: "2026-08-31" },
      { id: 3, contractNumber: null, contractDate: "2026-06-25", tenantName: "Вера", tenantContact: "C3", tenantEmail: "vera@example.com", propertyName: "Block C", unitName: "303", tariffType: "monthly", tariffAmount: "250", status: "active", startDate: "2026-08-01", endDate: "2026-08-31" },
    ];
    mocks.accruals = [
      { id: 11, contractId: 1, period: "2026-08", serviceFrom: "2026-08-01", serviceTo: "2026-08-31", quantity: "31", amount: "3100", amountEdited: true, status: "draft" },
      { id: 12, contractId: 2, period: "2026-08", serviceFrom: "2026-08-01", serviceTo: "2026-08-31", quantity: "1", amount: "200", status: "invoiced" },
      { id: 13, contractId: null, tenantName: "Разовый плательщик", propertyName: "Block C", unitName: "303", tariffType: "daily", tariffAmount: "150", period: "2026-08", serviceFrom: "2026-08-10", serviceTo: "2026-08-11", quantity: "2", amount: "300", status: "draft" },
      { id: 14, contractId: 3, period: "2026-08", serviceFrom: "2026-08-01", serviceTo: "2026-08-31", quantity: "1", amount: "250", status: "draft" },
    ];
    mocks.scanPreviewMutate.mockReset();
    mocks.moveToFolderMutate.mockReset();
    mocks.documents = [];
    mocks.documentDownloadData = undefined;
    mocks.invoices = [
      { id: 21, invoiceNumber: "СЧ-001", tenantName: "Анна", period: "2026-08", totalAmount: "3100", emailStatus: "sent" },
      { id: 22, invoiceNumber: "СЧ-002", tenantName: "Борис", period: "2026-08", totalAmount: "200", emailStatus: "failed" },
    ];
  });

  it("searches Contracts by contract number and contract date", () => {
    const { unmount } = render(<Contracts />);
    const input = screen.getByPlaceholderText("Номер, дата, ФИО, объект или Email");
    fireEvent.change(input, { target: { value: "Д-001" } });
    expect(screen.getByText("Анна")).toBeTruthy();
    expect(screen.queryByText("Борис")).toBeNull();
    fireEvent.change(input, { target: { value: "2026-06-20" } });
    expect(screen.getByText("Борис")).toBeTruthy();
    expect(screen.queryByText("Анна")).toBeNull();
    unmount();
  });

  it("filters Contracts by visible tariff/status and renders no-results", () => {
    const { unmount } = render(<Contracts />);
    fireEvent.change(screen.getByPlaceholderText("Номер, дата, ФИО, объект или Email"), { target: { value: "за сутки" } });
    expect(screen.getByText("Анна")).toBeTruthy();
    expect(screen.queryByText("Борис")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Номер, дата, ФИО, объект или Email"), { target: { value: "нет такого договора" } });
    expect(screen.getByText("По вашему запросу договоры не найдены.")).toBeTruthy();
    unmount();
  });

  it("accepts supported scan extensions when the browser MIME type is empty", () => {
    expect(getScanMimeType({ name: "договор.PDF", type: "" })).toBe("application/pdf");
    expect(getScanMimeType({ name: "scan.jpeg", type: "application/octet-stream" })).toBe("image/jpeg");
    expect(isSupportedScanFile({ name: "scan.png", type: "" })).toBe(true);
    expect(isSupportedScanFile({ name: "notes.txt", type: "" })).toBe(false);
  });

  it("shows per-file batch upload progress states", () => {
    render(<Contracts />);
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["a"], "Д-101 от 01.09.2026.pdf", { type: "application/pdf" }), new File(["b"], "Д-102 от 02.09.2026.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText("Прогресс файлов: 0/2 сохранено")).toBeTruthy();
    expect(screen.getAllByText("Ожидает проверки")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Убрать" })[0]);
    expect(screen.queryByText("Д-101 от 01.09.2026.pdf")).toBeNull();
  });

  it("offers Google Drive Picker next to computer upload", () => {
    render(<Contracts />);
    expect(screen.getByRole("button", { name: "Из Google Drive" })).toBeTruthy();
  });

  it("selects contracts and uses one confirmation for bulk archiving", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Contracts />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Выбрать договор Д-001" }));
    expect(screen.getByRole("button", { name: /Архивировать выбранные \(1\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Архивировать выбранные \(1\)/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it("moves a dragged contract to the dropped folder", () => {
    render(<Contracts />);
    const row = screen.getByText("Д-001").closest("tr");
    const folderCard = screen.getByTestId("contract-folder-drop-Блок А1");
    expect(row?.getAttribute("draggable")).toBe("true");
    expect(folderCard).toBeTruthy();
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    fireEvent.dragStart(row!, { dataTransfer });
    fireEvent.dragOver(folderCard!, { dataTransfer });
    fireEvent.drop(folderCard!, { dataTransfer });
    expect(mocks.moveToFolderMutate).toHaveBeenCalledWith({ ids: [1], folderName: "Блок А1" });
  });

  it("opens an attached contract scan in the viewer", () => {
    mocks.documents = [{ id: 501, contractId: 1, fileName: "Д-001.pdf", mimeType: "application/pdf" }];
    mocks.documentDownloadData = { fileName: "Д-001.pdf", mimeType: "application/pdf", dataBase64: "JVBERi0xLjQ=" };
    render(<Contracts />);
    fireEvent.click(screen.getByRole("button", { name: "Д-001.pdf" }));
    expect(screen.getByRole("dialog", { name: "Просмотр скана договора" })).toBeTruthy();
    expect(screen.getByTitle("Д-001.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Увеличить документ" }));
    expect(screen.getByText("125%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Скачать скан" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Полноэкранный режим" }));
    expect(screen.getByRole("button", { name: "Выйти из полноэкранного режима" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть просмотр скана" }));
    expect(screen.queryByRole("dialog", { name: "Просмотр скана договора" })).toBeNull();
  });

  it("shows active contracts by default, separates archive, and searches inside a folder", () => {
    mocks.contracts.push({ id: 4, contractNumber: "Д-004", contractDate: "2026-01-01", tenantName: "Архивный студент", tenantContact: "A4", tenantEmail: "archive@example.com", propertyName: "Block A", unitName: "404", tariffType: "monthly", tariffAmount: "300", status: "ended", archivedAt: "2026-09-01", startDate: "2026-01-01", endDate: "2026-08-31" });
    render(<Contracts />);
    expect(screen.queryByText("Архивный студент")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Архивные договоры" }));
    expect(screen.getByText("Архивный студент")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Выбрать договор Д-004" }));
    expect(screen.getByRole("button", { name: /Перенести выбранные \(1\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Активные договоры" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Блок А1/ })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск в выбранной папке" }), { target: { value: "Анна" } });
    expect(screen.getByText("Анна")).toBeTruthy();
    expect(screen.queryByText("Борис")).toBeNull();
  });

  it("filters Contracts by tariff and document selectors", () => {
    const { unmount } = render(<Contracts />);
    fireEvent.click(screen.getByRole("button", { name: "Доп. фильтры" }));
    const comboboxes = screen.getAllByRole("combobox");
    fireEvent.click(comboboxes[3]);
    fireEvent.click(screen.getByText("Суточный", { exact: true }));
    expect(screen.getByText("Анна")).toBeTruthy();
    expect(screen.queryByText("Борис")).toBeNull();
    fireEvent.click(comboboxes[5]);
    fireEvent.click(screen.getByText("Со сканом", { exact: true }));
    expect(screen.getByText("По вашему запросу договоры не найдены.")).toBeTruthy();
    unmount();
  });

  it("filters Accruals by visible tariff and renders no-results", () => {
    const { unmount } = render(<Accruals />);
    fireEvent.change(screen.getByPlaceholderText("ФИО, квартира, объект, тариф или период"), { target: { value: "за месяц" } });
    expect(screen.getByText("Борис")).toBeTruthy();
    expect(screen.queryByText("Анна")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("ФИО, квартира, объект, тариф или период"), { target: { value: "не найдено" } });
    expect(screen.getByText("По вашему запросу начисления не найдены.")).toBeTruthy();
    unmount();
  });

  it("shows monthly total, searches by apartment, and highlights manual amount edits", () => {
    render(<Accruals />);
    expect(screen.getByText(/Итого за \d{4}-\d{2}/)).toBeTruthy();
    expect(screen.getByText("Изменено вручную")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("ФИО, квартира, объект, тариф или период"), { target: { value: "101" } });
    expect(screen.getByText("Анна")).toBeTruthy();
    expect(screen.queryByText("Борис")).toBeNull();
  });

  it("highlights missing contract numbers in red without replacing manual-edit highlighting", () => {
    render(<Accruals />);
    const missingNumberRow = document.querySelector('[data-missing-contract-number="true"]') as HTMLElement;
    expect(missingNumberRow).toBeTruthy();
    expect(missingNumberRow.className).toContain("bg-red-50");
    expect(screen.getByText("Изменено вручную").closest("tr")?.className).toContain("bg-amber-50");
  });

  it("edits a draft accrual amount inline", () => {
    render(<Accruals />);
    fireEvent.click(screen.getAllByRole("button", { name: "Изменить" })[0]);
    const input = screen.getByRole("spinbutton", { name: "Сумма начисления 11" });
    fireEvent.change(input, { target: { value: "3250" } });
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeTruthy();
  });

  it("edits standalone email and confirms deleting a draft row", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Accruals />);
    fireEvent.click(screen.getByRole("button", { name: "Указать Email" }));
    const emailInput = screen.getByRole("textbox", { name: "Email начисления 13" });
    fireEvent.change(emailInput, { target: { value: "resident@example.com" } });
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeTruthy();
    const deleteButtons = screen.getAllByRole("button", { name: "Удалить" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(confirm).toHaveBeenCalledWith("Удалить это начисление? Действие нельзя отменить.");
    confirm.mockRestore();
  });

  it("shows standalone accruals as without contract", () => {
    render(<Accruals />);
    expect(screen.getByText("Без договора")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Предпросмотр Excel" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("ФИО, квартира, объект, тариф или период"), { target: { value: "разовый плательщик" } });
    expect(screen.getByText("Разовый плательщик")).toBeTruthy();
  });

  it("supports drag-over feedback, file drop, and OCR preview initiation", async () => {
    const { unmount } = render(<Contracts />);
    const uploadHeadings = screen.getAllByText("Загрузить сканы");
    fireEvent.click(uploadHeadings[uploadHeadings.length - 1]);
    const dropZone = screen.getByRole("button", { name: "Перетащите файл скана договора или выберите его" });
    expect(dropZone.getAttribute("tabindex")).toBe("0");
    fireEvent.dragOver(dropZone);
    expect(screen.getByText("Отпустите файлы здесь")).toBeTruthy();
    fireEvent.drop(dropZone, { dataTransfer: { files: [new File(["scan"], "contract.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(mocks.scanPreviewMutate).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "application/pdf", dataUrl: expect.stringContaining("data:application/pdf") })));
    fireEvent.keyDown(dropZone, { key: "Enter" });
    fireEvent.keyDown(dropZone, { key: " " });
    unmount();
  });

  it("shows the selected scan next to OCR fields before save", () => {
    const { unmount } = render(<ContractForm onDone={vi.fn()} scan={{ dataUrl: "data:image/png;base64,c2Nhbg==", fileName: "contract.png", mimeType: "image/png" }} prefill={{ contractNumber: "Д-2026-001", contractDate: "2026-07-15", tenantName: "Анна", propertyName: "Block A", startDate: "2026-08-01", endDate: "2026-08-31", tariffType: "monthly", tariffAmount: 100, confidence: 0.91, fieldConfidence: { tenantName: 0.95, propertyName: 0.42, startDate: 0.9, endDate: 0.9, tariffType: 0.9, tariffAmount: 0.9 } }} />);
    expect(screen.getByText("Предпросмотр документа")).toBeTruthy();
    expect(screen.getByAltText("Предпросмотр contract.png")).toBeTruthy();
    expect(screen.getByText("Плательщик / арендатор")).toBeTruthy();
    expect(screen.getByDisplayValue("Д-2026-001")).toBeTruthy();
    expect(screen.getByText("Проверьте номер перед сохранением")).toBeTruthy();
    expect(screen.getByText("До сохранения")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Увеличить масштаб" }));
    expect(screen.getByText("125%")).toBeTruthy();
    expect(screen.getByDisplayValue("Block A").className).toContain("bg-amber-50");
    expect(screen.getByDisplayValue("Анна").className).not.toContain("bg-amber-50");
    fireEvent.click(screen.getByRole("button", { name: "Уменьшить масштаб" }));
    expect(screen.getByText("100%")).toBeTruthy();
    unmount();
  });

  it("filters Invoices by visible email status and renders no-results", () => {
    const { unmount } = render(<Invoices />);
    fireEvent.change(screen.getByPlaceholderText("Номер, плательщик или период"), { target: { value: "Ошибка" } });
    expect(screen.getAllByText("СЧ-002").length).toBeGreaterThan(0);
    expect(screen.queryByText("СЧ-001")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Номер, плательщик или период"), { target: { value: "не найдено" } });
    expect(screen.getByText("По вашему запросу счета не найдены.")).toBeTruthy();
    unmount();
  });
});

describe("preview accrual recalculation", () => {
  it("keeps monthly tariff fixed when the period changes", () => {
    expect(calculateAccrualAmountByPeriod({ tariffType: "monthly", tariffAmount: "42000", serviceFrom: "2026-07-01", serviceTo: "2026-07-31" })).toBe(42000);
  });

  it("multiplies daily tariff by inclusive period days", () => {
    expect(calculateAccrualAmountByPeriod({ tariffType: "daily", tariffAmount: 1500, serviceFrom: "2026-07-01", serviceTo: "2026-07-03" })).toBe(4500);
  });

  it("returns null for an invalid period or tariff", () => {
    expect(calculateAccrualAmountByPeriod({ tariffType: "daily", tariffAmount: 0, serviceFrom: "2026-07-03", serviceTo: "2026-07-01" })).toBeNull();
  });
});
