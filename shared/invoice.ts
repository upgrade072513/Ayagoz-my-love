export const PAYMENT_OPTIONS = [
  { title: "Reception Desk (Block A1, Room 38)", detail: "Cards only, available 24/7." },
  { title: "NU Portal", detail: "Pay online via my.nu.edu.kz." },
  { title: "Payment Link from Block Manager", detail: "Your Block Manager can provide a personal payment link." },
] as const;

export function invoiceDueDate(period: string) {
  return new Date(`${period}-10T00:00:00Z`);
}

const russianMonths = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"] as const;

export function invoiceDueDateText(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `10 ${russianMonths[(month || 1) - 1]} ${year} года`;
}
