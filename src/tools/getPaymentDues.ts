import { z } from "zod";
import { policyFor } from "../agent/roles";
import { daysBetween } from "../lib/dates";
import { centsToDecimal } from "../lib/money";
import { isoDate, limit, supplierId } from "./common";
import { defineTool } from "./defineTool";
import { permissionDenied } from "./errors";
import { Query } from "./sql";

interface DueRow {
  po_number: string;
  supplier_id: number;
  supplier_name: string;
  due_date: string;
  status: string;
  amount_cents: number;
  amount_paid_cents: number;
}

export const getPaymentDues = defineTool({
  name: "get_payment_dues",
  description:
    "Outstanding supplier payments (unpaid and partially paid): total outstanding, overdue totals, the oldest overdue payment, " +
    "and the individual payments sorted by due date. 'Overdue' means due_date is before today and not fully paid. " +
    "Use for questions about money owed, dues, or overdue/late payments. Optionally filter by supplier_id (from search_suppliers). " +
    "Not for delivery questions.",
  input: z.object({
    supplier_id: supplierId.optional(),
    overdue_only: z.boolean().default(false).describe("true = only payments already past their due date."),
    due_before: isoDate.optional().describe("Only payments due on or before this date (YYYY-MM-DD)."),
    limit,
  }),
  async run(input, ctx) {
    // The registry already hides this tool from roles without payment access;
    // this second check is deliberate defense in depth.
    if (!policyFor(ctx.role).canSeePayments) throw permissionDenied("payment data");

    // Each query gets its own parameter list: Postgres rejects a $n that the SQL never uses.
    const filters = (q: Query): string => {
      const where = ["pay.status <> 'paid'", "po.status <> 'cancelled'"];
      if (input.supplier_id !== undefined) where.push(`po.supplier_id = ${q.param(input.supplier_id)}`);
      if (input.overdue_only) where.push(`pay.due_date < ${q.param(ctx.today)}`);
      if (input.due_before) where.push(`pay.due_date <= ${q.param(input.due_before)}`);
      return where.join(" AND ");
    };
    const from = `FROM payments pay JOIN purchase_orders po ON po.id = pay.po_id JOIN suppliers s ON s.id = po.supplier_id`;

    const tq = new Query();
    const tWhere = filters(tq);
    const today = tq.param(ctx.today);
    const totalsSql = `SELECT count(*) AS n,
        coalesce(sum(pay.amount_cents - pay.amount_paid_cents), 0)::bigint AS outstanding,
        count(*) FILTER (WHERE pay.due_date < ${today}) AS overdue_n,
        coalesce(sum(pay.amount_cents - pay.amount_paid_cents) FILTER (WHERE pay.due_date < ${today}), 0)::bigint AS overdue_amt
      ${from} WHERE ${tWhere}`;

    const rq = new Query();
    const rWhere = filters(rq);
    const rowsSql = `SELECT po.po_number, s.id AS supplier_id, s.name AS supplier_name, pay.due_date, pay.status,
        pay.amount_cents, pay.amount_paid_cents
      ${from} WHERE ${rWhere} ORDER BY pay.due_date, po.po_number LIMIT ${rq.param(input.limit)}`;

    const [totals, rows] = await Promise.all([
      ctx.db.query<{ n: number; outstanding: number; overdue_n: number; overdue_amt: number }>(totalsSql, tq.params),
      ctx.db.query<DueRow>(rowsSql, rq.params),
    ]);
    const t = totals.rows[0] ?? { n: 0, outstanding: 0, overdue_n: 0, overdue_amt: 0 };

    const payments = rows.rows.map((r) => {
      const overdue = r.due_date < ctx.today;
      return {
        po_number: r.po_number,
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        due_date: r.due_date,
        status: r.status,
        amount: centsToDecimal(r.amount_cents),
        amount_paid: centsToDecimal(r.amount_paid_cents),
        outstanding_amount: centsToDecimal(r.amount_cents - r.amount_paid_cents),
        days_overdue: overdue ? daysBetween(r.due_date, ctx.today) : 0,
      };
    });
    // Rows are sorted by due date, so the first overdue row is the oldest.
    const oldest = payments.find((p) => p.days_overdue > 0) ?? null;

    return {
      currency: ctx.currency,
      total_count: t.n,
      total_outstanding_amount: centsToDecimal(t.outstanding),
      overdue_count: t.overdue_n,
      overdue_outstanding_amount: centsToDecimal(t.overdue_amt),
      oldest_overdue: oldest,
      returned: payments.length,
      payments,
    };
  },
});
