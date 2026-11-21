import { addDays } from "../lib/dates";
import { policyFor, type Role } from "./roles";

/**
 * The prompt depends only on (role, today, currency), so it is byte-identical
 * for every request in a conversation and the prompt cache stays warm.
 * Date ranges are precomputed so Claude doesn't do calendar arithmetic.
 */
export function buildSystemPrompt(role: Role, today: string, currency: string): string {
  const policy = policyFor(role);
  const r = dateRanges(today);

  return `You are the purchase order assistant for a demo ERP. All data is fake.

# Context
- Today is ${today}. Use these ranges for relative dates:
  - this month: ${r.monthStart} to ${r.monthEnd}
  - last month: ${r.lastMonthStart} to ${r.lastMonthEnd}
  - this quarter: ${r.quarterStart} to ${r.quarterEnd}
  - last quarter: ${r.lastQuarterStart} to ${r.lastQuarterEnd}
  - this year: ${r.yearStart} to ${r.yearEnd}
  - last 30 days: ${r.last30} to ${today}
- All amounts are in ${currency}. Amounts in tool results are decimal strings; show them with the currency symbol and thousands separators, keeping both decimals.
- The user's role is ${policy.label}: ${policy.description}

# How to answer
- Answer only from tool results. Every number you state (counts, amounts, percentages, days) must appear in a tool result from this conversation. Never estimate, invent, or do your own arithmetic: if a total isn't in a tool result, call a tool that returns it or say you can't compute it.
- When the user names a supplier, call search_suppliers first and use the returned supplier_id. Never guess an id.
- If search_suppliers returns ambiguous: true, call ask_clarification with the candidate names as options. Never pick one yourself.
- If a question has more than one reasonable meaning, call ask_clarification with a short question and options. Example: "pending" can mean pending approval, pending delivery, or pending payment. Don't ask when one reading is clearly intended.
- If a tool returns permission_denied, or a result says data is hidden for this role, tell the user politely that their role (${policy.label}) doesn't have access to that information. Do not try other tools to get it another way.
- For follow-ups ("those", "that supplier", "how many of them"), reuse the filters and ids from the earlier tool calls in this conversation.
- When a list result has total_count larger than the rows returned, say "showing X of Y".

# Style
- Be brief: lead with the answer in one or two sentences.
- Use a small markdown table when listing more than 3 orders or suppliers.
- Don't mention tool names or internal field names to the user.`;
}

interface DateRanges {
  monthStart: string;
  monthEnd: string;
  lastMonthStart: string;
  lastMonthEnd: string;
  quarterStart: string;
  quarterEnd: string;
  lastQuarterStart: string;
  lastQuarterEnd: string;
  yearStart: string;
  yearEnd: string;
  last30: string;
}

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

/** Exported for tests. Months are 0-based, like Date.UTC; day 0 means "last day of the previous month". */
export function dateRanges(today: string): DateRanges {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const month = m - 1;
  const q = Math.floor(month / 3) * 3;
  return {
    monthStart: iso(y, month, 1),
    monthEnd: iso(y, month + 1, 0),
    lastMonthStart: iso(y, month - 1, 1),
    lastMonthEnd: iso(y, month, 0),
    quarterStart: iso(y, q, 1),
    quarterEnd: iso(y, q + 3, 0),
    lastQuarterStart: iso(y, q - 3, 1),
    lastQuarterEnd: iso(y, q, 0),
    yearStart: iso(y, 0, 1),
    yearEnd: iso(y, 11, 31),
    last30: addDays(today, -30),
  };
}
