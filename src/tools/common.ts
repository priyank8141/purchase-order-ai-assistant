import { z } from "zod";
import { policyFor } from "../agent/roles";
import type { ToolContext } from "./defineTool";
import { permissionDenied } from "./errors";
import type { Query } from "./sql";

export const PO_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "partially_delivered",
  "delivered",
  "cancelled",
] as const;

/** Orders that are with the supplier but not fully delivered yet. */
export const OPEN_DELIVERY_STATUSES = ["approved", "partially_delivered"] as const;

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  // Round-trip check rejects dates JS would silently roll over, like 2026-02-30.
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a real date");

export const supplierId = z.number().int().positive().describe("Supplier id from search_suppliers. Never guess an id.");

export const limit = z.number().int().min(1).max(50).default(20).describe("Max rows to return (1-50, default 20).");

export const poFilters = {
  supplier_id: supplierId.optional(),
  status: z.array(z.enum(PO_STATUSES)).min(1).optional().describe("Only orders in these statuses."),
  date_from: isoDate.optional().describe("Order date on or after (YYYY-MM-DD)."),
  date_to: isoDate.optional().describe("Order date on or before (YYYY-MM-DD)."),
  overdue_delivery: z
    .boolean()
    .optional()
    .describe("true = approved or partially delivered orders whose expected delivery date has passed."),
  delivered_late: z
    .boolean()
    .optional()
    .describe("true = delivered orders that arrived after their expected delivery date."),
  payment_overdue: z
    .boolean()
    .optional()
    .describe(
      "true = orders with at least one unpaid or partially paid payment past its due date. Accounts/admin only.",
    ),
};

export type PoFilters = z.output<z.ZodObject<typeof poFilters>>;

export function checkDateRange(from: string | undefined, to: string | undefined): boolean {
  return !from || !to || from <= to;
}

/** SQL conditions on alias `po` for the shared filters. All values are parameterized. */
export function poFilterConditions(f: PoFilters, q: Query, ctx: ToolContext): string[] {
  const where: string[] = [];
  if (f.supplier_id !== undefined) where.push(`po.supplier_id = ${q.param(f.supplier_id)}`);
  if (f.status) where.push(`po.status = ANY(${q.param(f.status)}::po_status[])`);
  if (f.date_from) where.push(`po.order_date >= ${q.param(f.date_from)}`);
  if (f.date_to) where.push(`po.order_date <= ${q.param(f.date_to)}`);
  if (f.overdue_delivery !== undefined) {
    const cond = `(po.status IN ('approved', 'partially_delivered') AND po.expected_delivery_date < ${q.param(ctx.today)})`;
    where.push(f.overdue_delivery ? cond : `NOT ${cond}`);
  }
  if (f.delivered_late !== undefined) {
    const cond = `(po.delivered_date IS NOT NULL AND po.delivered_date > po.expected_delivery_date)`;
    where.push(f.delivered_late ? cond : `NOT ${cond}`);
  }
  if (f.payment_overdue !== undefined) {
    // Filtering by payment state reveals payment data, so it's gated too.
    if (!policyFor(ctx.role).canSeePayments) throw permissionDenied("payment data");
    const cond = `EXISTS (SELECT 1 FROM payments pay WHERE pay.po_id = po.id AND pay.status <> 'paid' AND pay.due_date < ${q.param(ctx.today)})`;
    where.push(f.payment_overdue ? cond : `NOT ${cond}`);
  }
  return where;
}

export function whereClause(conditions: string[]): string {
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}
