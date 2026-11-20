import { z } from "zod";
import { policyFor } from "../agent/roles";
import { centsToDecimal } from "../lib/money";
import { checkDateRange, limit, poFilterConditions, poFilters, whereClause } from "./common";
import { defineTool } from "./defineTool";
import { permissionDenied } from "./errors";
import { Query } from "./sql";

const SORTS = {
  order_date_desc: "po.order_date DESC, po.po_number DESC",
  order_date_asc: "po.order_date ASC, po.po_number ASC",
  expected_delivery_asc: "po.expected_delivery_date ASC, po.po_number ASC",
  total_amount_desc: "po.total_amount_cents DESC, po.po_number ASC",
} as const;

interface Row {
  po_number: string;
  supplier_id: number;
  supplier_name: string;
  status: string;
  order_date: string;
  expected_delivery_date: string;
  delivered_date: string | null;
  total_amount_cents: number;
  currency: string;
}

export const listPurchaseOrders = defineTool({
  name: "list_purchase_orders",
  description:
    "List individual purchase orders matching filters (PO number, supplier, status, dates, amount). " +
    "Use when the user wants to see which orders, not just how many. Returns total_count (all matches) " +
    "plus up to `limit` rows, so say 'showing X of Y' when total_count is larger. " +
    "Dates filter on order_date. For a single PO's items and payments use get_purchase_order_details.",
  input: z
    .object({
      ...poFilters,
      limit,
      sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default("order_date_desc"),
    })
    .refine((v) => checkDateRange(v.date_from, v.date_to), "date_from must be on or before date_to"),
  async run(input, ctx) {
    // Sorting by amount would leak amount ordering to roles that can't see amounts.
    if (input.sort === "total_amount_desc" && !policyFor(ctx.role).canSeeAmounts) {
      throw permissionDenied("order amounts");
    }
    const q = new Query();
    const where = whereClause(poFilterConditions(input, q, ctx));
    const countParams = [...q.params];
    const lim = q.param(input.limit);

    const [rows, count] = await Promise.all([
      ctx.db.query<Row>(
        `SELECT po.po_number, po.supplier_id, s.name AS supplier_name, po.status, po.order_date,
                po.expected_delivery_date, po.delivered_date, po.total_amount_cents, po.currency
           FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
           ${where}
          ORDER BY ${SORTS[input.sort]}
          LIMIT ${lim}`,
        q.params,
      ),
      ctx.db.query<{ n: number }>(`SELECT count(*) AS n FROM purchase_orders po ${where}`, countParams),
    ]);

    return {
      total_count: count.rows[0]?.n ?? 0,
      returned: rows.rows.length,
      orders: rows.rows.map((r) => ({
        po_number: r.po_number,
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        status: r.status,
        order_date: r.order_date,
        expected_delivery_date: r.expected_delivery_date,
        delivered_date: r.delivered_date,
        total_amount: centsToDecimal(r.total_amount_cents),
        currency: r.currency,
      })),
    };
  },
});
