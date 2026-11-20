import { policyFor, type Role } from "../agent/roles";

/**
 * Money and payment fields follow a naming convention across all tools:
 * anything containing "amount", "price" or "payment" in its key. Redaction is
 * key-based so a new tool can't accidentally leak amounts by forgetting a check.
 */
const RESTRICTED_KEY = /amount|price|payment/i;

export const HIDDEN_NOTE_KEY = "hidden_for_your_role";

/**
 * Deep-copies `value`, dropping money/payment keys if the role can't see them.
 * When anything was dropped, adds a note so Claude can tell the user why.
 */
export function redactForRole<T extends Record<string, unknown>>(value: T, role: Role): T {
  const policy = policyFor(role);
  if (policy.canSeeAmounts && policy.canSeePayments) return value;
  const state = { removed: false };
  const out = strip(value, state) as Record<string, unknown>;
  if (state.removed) out[HIDDEN_NOTE_KEY] = "Amounts, prices and payment data are not available to this role.";
  return out as T;
}

function strip(value: unknown, state: { removed: boolean }): unknown {
  if (Array.isArray(value)) return value.map((v) => strip(v, state));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (RESTRICTED_KEY.test(k)) state.removed = true;
      else out[k] = strip(v, state);
    }
    return out;
  }
  return value;
}
