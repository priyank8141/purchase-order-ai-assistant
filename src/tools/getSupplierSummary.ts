import { z } from "zod";
import { centsToDecimal } from "../lib/money";
import { checkDateRange, isoDate, PO_STATUSES, supplierId } from "./common";
import { defineTool } from "./defineTool";
import { pct, Query } from "./sql";

export const getSupplierSummary = defineTool({
  name: "get_supplier_summary",
  description:
    "Performance overview of ONE supplier: total orders, total order value (excluding cancelled orders), " +
    "count by status, and on-time delivery rate. Dates filter on order_date and are optional (default: all time). " +
    "Requires supplier_id from search_suppliers. Not for comparing or ranking suppliers (use get_delivery_summary " +
    "or count_purchase_orders with group_by='supplier').",
  input: z
    .object({
      supplier_id: supplierId,
      date_from: isoDate.optional().describe("Order date on or after (YYYY-MM-DD)."),
      date_to: isoDate.optional().describe("Order date on or before (YYYY-MM-DD)."),
    })
    .refine((v) => checkDateRange(v.date_from, v.date_to), "date_from must be on or before date_to"),
  async run({ supplier_id, date_from, date_to }, ctx) {
    const supplier = await ctx.db.query<{ id: number; name: string; city: string; country: string; category: string }>(
      "SELECT id, name, city, country, category FROM suppliers WHERE id = $1",
      [supplier_id],
    );
    const s = supplier.rows[0];
    if (!s) return { found: false, message: `No supplier with id ${supplier_id}. Use search_suppliers to find the id.` };

    const q = new Query();
    const where = [`po.supplier_id = ${q.param(supplier_id)}`];
    if (date_from) where.push(`po.order_date >= ${q.param(date_from)}`);
    if (date_to) where.push(`po.order_date <= ${q.param(date_to)}`);

    const { rows } = await ctx.db.query<{
      status: string;
      n: number;
      value_cents: number;
      on_time: number;
      late: number;
    }>(
      `SELECT po.status, count(*) AS n, sum(po.total_amount_cents)::bigint AS value_cents,
              count(*) FILTER (WHERE po.delivered_date <= po.expected_delivery_date) AS on_time,
              count(*) FILTER (WHERE po.delivered_date > po.expected_delivery_date) AS late
         FROM purchase_orders po
        WHERE ${where.join(" AND ")}
        GROUP BY po.status`,
      q.params,
    );

    const byStatus = Object.fromEntries(PO_STATUSES.map((st) => [st, 0]));
    let total = 0;
    let valueCents = 0;
    let onTime = 0;
    let late = 0;
    for (const r of rows) {
      byStatus[r.status] = r.n;
      total += r.n;
      if (r.status !== "cancelled") valueCents += r.value_cents;
      onTime += r.on_time;
      late += r.late;
    }

    return {
      supplier: { supplier_id: s.id, name: s.name, city: s.city, country: s.country, category: s.category },
      period: { date_from: date_from ?? null, date_to: date_to ?? null },
      total_orders: total,
      total_amount: centsToDecimal(valueCents),
      currency: ctx.currency,
      by_status: byStatus,
      deliveries_completed: onTime + late,
      delivered_on_time: onTime,
      delivered_late: late,
      on_time_delivery_rate_pct: pct(onTime, onTime + late),
    };
  },
});
