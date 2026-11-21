import { z } from "zod";
import { checkDateRange, isoDate, limit, supplierId } from "./common";
import { defineTool } from "./defineTool";
import { pct, Query } from "./sql";

const SORTS = {
  late_desc: "delivered_late DESC, overdue_open DESC",
  overdue_desc: "overdue_open DESC, delivered_late DESC",
  delivered_desc: "delivered DESC",
  on_time_rate_asc: "(delivered_on_time::float / NULLIF(delivered, 0)) ASC NULLS LAST",
} as const;

interface Row {
  supplier_id: number;
  supplier_name: string;
  delivered: number;
  delivered_on_time: number;
  delivered_late: number;
  pending: number;
  partially_delivered: number;
  overdue_open: number;
}

export const getDeliverySummary = defineTool({
  name: "get_delivery_summary",
  description:
    "Delivery performance for a period. Counts: delivered (delivered_date in the period), split into on-time and late; " +
    "pending (approved, expected in the period, nothing received); partially_delivered (expected in the period); " +
    "overdue_open (pending or partial whose expected date in the period has already passed). " +
    "Use for late deliveries, on-time rate, and what's due to arrive. Set group_by='supplier' to compare or rank suppliers " +
    "(e.g. 'which supplier had the most late deliveries this quarter' -> group_by='supplier', sort='late_desc'). " +
    "Compute date_from/date_to from today's date for phrases like 'this quarter'.",
  input: z
    .object({
      date_from: isoDate.describe("Period start (YYYY-MM-DD), inclusive."),
      date_to: isoDate.describe("Period end (YYYY-MM-DD), inclusive."),
      supplier_id: supplierId.optional(),
      group_by: z.enum(["supplier"]).optional(),
      sort: z
        .enum(Object.keys(SORTS) as [keyof typeof SORTS])
        .default("late_desc")
        .describe("Ordering for group_by='supplier'."),
      limit: limit.describe("Max suppliers when group_by='supplier' (1-50, default 20)."),
    })
    .refine((v) => checkDateRange(v.date_from, v.date_to), "date_from must be on or before date_to"),
  async run(input, ctx) {
    const q = new Query();
    const from = q.param(input.date_from);
    const to = q.param(input.date_to);
    const today = q.param(ctx.today);
    const supplierFilter = input.supplier_id !== undefined ? `AND po.supplier_id = ${q.param(input.supplier_id)}` : "";

    const delivered = `po.status = 'delivered' AND po.delivered_date BETWEEN ${from} AND ${to}`;
    const expectedInPeriod = `po.expected_delivery_date BETWEEN ${from} AND ${to}`;
    const { rows } = await ctx.db.query<Row>(
      `SELECT s.id AS supplier_id, s.name AS supplier_name,
              count(*) FILTER (WHERE ${delivered}) AS delivered,
              count(*) FILTER (WHERE ${delivered} AND po.delivered_date <= po.expected_delivery_date) AS delivered_on_time,
              count(*) FILTER (WHERE ${delivered} AND po.delivered_date > po.expected_delivery_date) AS delivered_late,
              count(*) FILTER (WHERE po.status = 'approved' AND ${expectedInPeriod}) AS pending,
              count(*) FILTER (WHERE po.status = 'partially_delivered' AND ${expectedInPeriod}) AS partially_delivered,
              count(*) FILTER (WHERE po.status IN ('approved', 'partially_delivered') AND ${expectedInPeriod}
                                 AND po.expected_delivery_date < ${today}) AS overdue_open
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE (${delivered} OR ${expectedInPeriod}) ${supplierFilter}
        GROUP BY s.id, s.name
        ORDER BY ${SORTS[input.sort]}, s.name`,
      q.params,
    );

    const sum = (k: keyof Row) => rows.reduce((acc, r) => acc + (r[k] as number), 0);
    const totals = {
      delivered: sum("delivered"),
      delivered_on_time: sum("delivered_on_time"),
      delivered_late: sum("delivered_late"),
      pending: sum("pending"),
      partially_delivered: sum("partially_delivered"),
      overdue_open: sum("overdue_open"),
    };
    const result: Record<string, unknown> = {
      period: { date_from: input.date_from, date_to: input.date_to },
      ...totals,
      on_time_rate_pct: pct(totals.delivered_on_time, totals.delivered),
    };
    if (input.group_by === "supplier") {
      result.suppliers_total_count = rows.length;
      result.by_supplier = rows.slice(0, input.limit).map((r) => ({
        ...r,
        on_time_rate_pct: pct(r.delivered_on_time, r.delivered),
      }));
    }
    return result;
  },
});
