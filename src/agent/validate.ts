import type { ToolRun } from "../tools/index";
import type { MessageParam } from "./loop";

/**
 * Response validation: every number Claude states must come from data it was
 * given. This catches invented or self-computed numbers (sums, differences,
 * estimates). It cannot catch a correct number attached to the wrong label;
 * see the README for limits.
 */

export interface ExtractedNumber {
  /** As written in the text, e.g. "$12,345.67" or "87%". */
  raw: string;
  value: number;
  /** Decimal places as written; matching rounds the source value to this precision. */
  decimals: number;
}

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** Spans removed before extraction: identifiers and dates are not "numbers" to verify. */
const IGNORED_SPANS: RegExp[] = [
  /\bPO-\d{4}-\d{4}\b/gi, // PO numbers
  /\bSUP-\d+\b/gi, // supplier codes
  /\b\d{4}-\d{2}-\d{2}\b/g, // 2026-11-15
  /\b\d{4}-\d{2}\b/g, // 2026-11
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // 15/11/2026
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"), // Nov 15, 2026
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\.?(?:,?\\s+\\d{4})?\\b`, "gi"), // 15 November 2026
  /\bQ[1-4]\b/gi, // quarters
  /^\s*\d+[.)]\s/gm, // markdown list markers "1. "
];

/**
 * A standalone number: optional currency symbol, thousands separators (Western
 * or Indian grouping), decimals, optional %. Numbers glued to letters (M12,
 * 150W, 6x4m) are part of names and skipped.
 */
const NUMBER = /(?<![\w./])([$₹€£]\s?)?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?(\s?%)?(?![\w])/g;

export function extractNumbers(text: string): ExtractedNumber[] {
  let cleaned = text;
  for (const re of IGNORED_SPANS) cleaned = cleaned.replace(re, " ");
  const out: ExtractedNumber[] = [];
  for (const m of cleaned.matchAll(NUMBER)) {
    const [raw, currency, intPart, decPart] = m;
    const grouped = intPart!.includes(",");
    const value = Number(`${intPart!.replace(/,/g, "")}${decPart ? `.${decPart}` : ""}`);
    // A bare 4-digit year ("in 2026") is a date, not a quantity.
    if (!currency && !grouped && !decPart && value >= 1900 && value <= 2100) continue;
    out.push({ raw: raw.trim(), value, decimals: decPart?.length ?? 0 });
  }
  return out;
}

/** Every number Claude could legitimately cite this turn. */
export function collectSupportedNumbers(runs: ToolRun[], question: string, history: MessageParam[] = []): number[] {
  const found: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) found.push(v);
    else if (typeof v === "string") {
      if (/^-?\d+(\.\d+)?$/.test(v)) found.push(Number(v)); // decimal amounts like "12345.67"
      else for (const n of extractNumbers(v)) found.push(n.value); // numbers inside names
    } else if (Array.isArray(v)) {
      found.push(v.length); // derived: "showing 5 orders"
      v.forEach(walk);
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };

  for (const run of runs) {
    walk(run.output);
    walk(run.input); // e.g. limit: 3 -> "top 3 suppliers"
  }
  // Follow-ups may restate numbers from earlier turns' tool results.
  for (const m of history) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type !== "tool_result" || typeof b.content !== "string") continue;
      try {
        walk(JSON.parse(b.content));
      } catch {
        // Non-JSON tool content: nothing to collect.
      }
    }
  }
  for (const n of extractNumbers(question)) found.push(n.value);
  return found;
}

/** True if `n` equals some supported value rounded to the precision it was written with. */
export function isSupported(n: ExtractedNumber, supported: number[]): boolean {
  const factor = 10 ** n.decimals;
  return supported.some((s) => Math.round(Math.abs(s) * factor) === Math.round(n.value * factor));
}

export type ValidationStatus = "verified" | "unverified" | "not_applicable";

export interface ValidationResult {
  status: ValidationStatus;
  /** Numbers in the answer that no source supports, as written. */
  unsupported: string[];
  checked: number;
}

export function validateAnswer(answer: string, supported: number[]): ValidationResult {
  const numbers = extractNumbers(answer);
  if (numbers.length === 0) return { status: "not_applicable", unsupported: [], checked: 0 };
  const unsupported = [...new Set(numbers.filter((n) => !isSupported(n, supported)).map((n) => n.raw))];
  return { status: unsupported.length ? "unverified" : "verified", unsupported, checked: numbers.length };
}

/** For the traces table: true/false, or null when there was nothing to check. */
export function validationPassed(status: ValidationStatus): boolean | null {
  return status === "not_applicable" ? null : status === "verified";
}

export function retryInstruction(unsupported: string[]): string {
  return (
    `Automatic check: your answer contains numbers that do not appear in any tool result: ${unsupported.join(", ")}. ` +
    "Rewrite the answer using only numbers that appear exactly in the tool results. Do not add, subtract or estimate. " +
    "You may call tools again if you need a number you don't have. Do not mention this check."
  );
}

export const UNVERIFIED_WARNING = "⚠️ Some numbers could not be verified.";
