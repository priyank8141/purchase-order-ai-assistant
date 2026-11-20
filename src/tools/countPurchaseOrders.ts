import { z } from "zod";
import { checkDateRange, limit, PO_STATUSES, poFilterConditions, poFilters, whereClause } from "./common";
import { defineTool } from "./defineTool";
import { Query } from "./sql";

export const countPurchaseOrders = defineTool({
  name: "count_purchase_orders",
  description:
    "Count purchase orders matching filters, with a breakdown by status. Use for 'how many' questions about orders. " +
    "Set group_by='supplier' to rank suppliers by order count (e.g. 'which supplier has the most open orders'). " +
    "Dates filter on order_date. Do not use this to list individual orders (use list_purchase_orders) " +
    "or for delivery performance over a period (use get_delivery_summary).",
  input: z
    .object({
      ...poFilters,
      group_by: z.enum(["supplier"]).optional().describe("Also return counts per supplier, highest first."),
      limit: limit.describe("Max suppliers when group_by='supplier' (1-50, default 20)."),
    })
    .refine((v) => checkDateRange(v.date_from, v.date_to), "date_from must be on or before date_to"),
  async run(input, ctx) {
    const q = new Query();
    const where = whereClause(poFilterConditions(input, q, ctx));

    const { rows } = await ctx.db.query<{ status: string; n: number }>(
      `SELECT po.status, count(*) AS n FROM purchase_orders po ${where} GROUP BY po.status`,
      q.params,
    );
    const byStatus = Object.fromEntries(PO_STATUSES.map((s) => [s, 0]));
    for (const r of rows) byStatus[r.status] = r.n;
    const total = rows.reduce((sum, r) => sum + r.n, 0);

    if (input.group_by !== "supplier") return { total_count: total, by_status: byStatus };

    const lim = q.param(input.limit);
    const grouped = await ctx.db.query<{ supplier_id: number; supplier_name: string; count: number }>(
      `SELECT s.id AS supplier_id, s.name AS supplier_name, count(*) AS count
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
         ${where}
        GROUP BY s.id, s.name
        ORDER BY count DESC, s.name
        LIMIT ${lim}`,
      q.params,
    );
    const supplierCount = await ctx.db.query<{ n: number }>(
      `SELECT count(DISTINCT po.supplier_id) AS n FROM purchase_orders po ${where}`,
      q.params.slice(0, -1),
    );
    return {
      total_count: total,
      by_status: byStatus,
      by_supplier: grouped.rows,
      suppliers_total_count: supplierCount.rows[0]?.n ?? 0,
    };
  },
});
