import Decimal from "decimal.js";

/** Canonical decimal string, as stage 2 stores it. */
export const canon = (d: Decimal.Value) => new Decimal(d).toString();

/** 1234.5 -> "1,234.50" */
export function grouped(d: Decimal.Value, dp: number) {
  const [i, f] = new Decimal(d).toFixed(dp).split(".");
  return i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : "");
}

const MONTHS = ["JAN.", "FEB.", "MAR.", "APR.", "MAY", "JUN.", "JUL.", "AUG.", "SEP.", "OCT.", "NOV.", "DEC."];
/** "2026-10-30" -> "OCT. 30, 2026" */
export const usDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
/** "2026-10-30" -> "115/10/30" (ROC calendar) */
export const rocDate = (iso: string) => `${Number(iso.slice(0, 4)) - 1911}/${iso.slice(5, 7)}/${iso.slice(8, 10)}`;

const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE",
  "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

/** Integers below one million, as printed in "SAY TOTAL" lines. */
export function words(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} HUNDRED${n % 100 ? ` AND ${words(n % 100)}` : ""}`;
  return `${words(Math.floor(n / 1000))} THOUSAND${n % 1000 ? ` ${words(n % 1000)}` : ""}`;
}
