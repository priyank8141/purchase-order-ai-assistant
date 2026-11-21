import { extractNumbers, isSupported } from "../src/agent/validate";

/** Pure scoring helpers for the eval runner (no I/O, no API calls). */

export interface CheckResult {
  ok: boolean;
  detail: string;
}

/**
 * Each expected entry must be called. "a|b" means either tool is acceptable,
 * since some questions can be answered correctly by more than one tool.
 */
export function checkTools(expected: string[], called: string[]): CheckResult {
  const missing = expected.filter((e) => !e.split("|").some((alt) => called.includes(alt)));
  return { ok: missing.length === 0, detail: missing.length ? `missing ${missing.join(", ")}` : "ok" };
}

/** Numeric values must appear as a number in the answer (rounding to the precision written); text values case-insensitively. */
export function checkAnswerContains(answer: string, values: string[]): CheckResult {
  const numbers = extractNumbers(answer);
  const lower = answer.toLowerCase();
  const missing = values.filter((v) => {
    if (/^-?\d+(\.\d+)?$/.test(v)) return !numbers.some((n) => isSupported(n, [Number(v)]));
    const text = v.toLowerCase();
    return !lower.includes(text) && !lower.includes(text.replace(/_/g, " "));
  });
  return { ok: missing.length === 0, detail: missing.length ? `missing ${missing.join(", ")}` : "ok" };
}

/** Every expected supplier name must be offered, as a clickable option or in the question text. */
export function checkClarifiesWith(options: string[], question: string, names: string[]): CheckResult {
  const haystack = [...options, question].join("\n").toLowerCase();
  const missing = names.filter((n) => !haystack.includes(n.toLowerCase()));
  return { ok: missing.length === 0, detail: missing.length ? `not offered: ${missing.join(", ")}` : "ok" };
}

/** A currency amount in the answer means restricted data leaked. */
export function checkNoAmounts(answer: string): CheckResult {
  const leaked = answer.match(/[$₹€£]\s?\d[\d,]*(\.\d+)?/);
  return { ok: !leaked, detail: leaked ? `leaked ${leaked[0]}` : "ok" };
}
