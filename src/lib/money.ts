/**
 * Money is stored and aggregated as integer cents everywhere. It is converted
 * to a decimal string only at the edges (tool output for Claude, UI display),
 * using integer math so there are no floating point surprises.
 */

/** 1234567 -> "12345.67", -5 -> "-0.05". */
export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Invalid cents value: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const major = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, "0");
  return `${sign}${major}.${minor}`;
}

/** Display formatting for the UI, e.g. formatMoney("12345.67", "USD") -> "$12,345.67". */
export function formatMoney(decimal: string, currency: string, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(decimal));
}
