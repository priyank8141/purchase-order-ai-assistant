/**
 * Minimal parameterized query builder. Values only ever enter SQL through
 * `param()`, which returns a `$n` placeholder. Tools never interpolate input.
 */
export class Query {
  readonly params: unknown[] = [];

  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }
}

/** Escapes LIKE wildcards so user text is matched literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** pg returns COUNT/SUM over bigint as strings or numbers depending on type; normalize. */
export function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Expected integer, got ${String(value)}`);
  return n;
}

/** Rounded percentage with one decimal, or null when there is no denominator. */
export function pct(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}
