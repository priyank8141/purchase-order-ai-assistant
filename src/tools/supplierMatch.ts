export interface SupplierCandidate {
  id: number;
  name: string;
  city: string;
  score: number;
  exact: boolean;
}

export type MatchResult =
  | { status: "resolved"; supplier: SupplierCandidate; candidates: SupplierCandidate[] }
  | { status: "ambiguous"; candidates: SupplierCandidate[] }
  | { status: "none"; candidates: SupplierCandidate[] };

/** Below this, a candidate is noise rather than a plausible match. */
export const MIN_SCORE = 0.3;
/** The top match must beat the runner-up by this much to be picked without asking. */
export const CLEAR_LEAD = 0.15;

/**
 * Decides whether a search resolved to one supplier or needs clarification.
 * Rules, in order:
 *  1. A case-insensitive exact name match wins outright.
 *  2. Drop candidates scoring below MIN_SCORE. None left -> "none".
 *  3. One left, or the top leads the runner-up by >= CLEAR_LEAD -> "resolved".
 *  4. Otherwise -> "ambiguous": the user must choose. Never guess.
 * `candidates` must be sorted by score, highest first.
 */
export function resolveSupplierMatch(candidates: SupplierCandidate[]): MatchResult {
  const exact = candidates.find((c) => c.exact);
  if (exact) return { status: "resolved", supplier: exact, candidates: [exact] };

  const plausible = candidates.filter((c) => c.score >= MIN_SCORE);
  const [top, second] = plausible;
  if (!top) return { status: "none", candidates: [] };
  if (!second || top.score - second.score >= CLEAR_LEAD) {
    return { status: "resolved", supplier: top, candidates: [top] };
  }
  // Only list candidates that are genuinely close to the top one.
  return { status: "ambiguous", candidates: plausible.filter((c) => top.score - c.score < CLEAR_LEAD) };
}
