import { z } from "zod";
import { policyFor } from "../agent/roles";
import { daysBetween } from "../lib/dates";
import { centsToDecimal } from "../lib/money";
import { defineTool } from "./defineTool";

interface Header {
  id: number;
  po_number: string;
  supplier_id: number;
  supplier_name: string;
  status: string;
  order_date: string;
  expected_delivery_date: string;
  delivered_date: string | null;
  total_amount_cents: number;
  currency: string;
  created_by: string;
}

export const getPurchaseOrderDetails = defineTool({
  name: "get_purchase_order_details",
  description:
    "Full details of ONE purchase order by PO number (e.g. PO-2026-0042): header, line items with received quantities, " +
    "delivery timeliness, and payments (payments only for roles that can see them). " +
    "Use for 'what's the status of PO-…' or 'what's on PO-…'. Do not use to search or list orders.",
  input: z.object({
    po_number: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^PO-\d{4}-\d{4}$/, "PO numbers look like PO-2026-0042")
      .describe("Exact PO number, format PO-YYYY-NNNN."),
  }),
  async run({ po_number }, ctx) {
    const header = await ctx.db.query<Header>(
      `SELECT po.id, po.po_number, po.supplier_id, s.name AS supplier_name, po.status, po.order_date,
              po.expected_delivery_date, po.delivered_date, po.total_amount_cents, po.currency, po.created_by
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.po_number = $1`,
      [po_number],
    );
    const po = header.rows[0];
    if (!po) return { found: false, message: `No purchase order ${po_number} exists.` };

    const items = await ctx.db.query<{
      item_name: string;
      sku: string;
      quantity: number;
      quantity_received: number;
      unit_price_cents: number;
    }>(
      `SELECT item_name, sku, quantity, quantity_received, unit_price_cents FROM po_items WHERE po_id = $1 ORDER BY id`,
      [po.id],
    );

    const result: Record<string, unknown> = {
      found: true,
      po_number: po.po_number,
      supplier_id: po.supplier_id,
      supplier_name: po.supplier_name,
      status: po.status,
      order_date: po.order_date,
      expected_delivery_date: po.expected_delivery_date,
      delivered_date: po.delivered_date,
      delivery: deliveryTimeliness(po, ctx.today),
      created_by: po.created_by,
      total_amount: centsToDecimal(po.total_amount_cents),
      currency: po.currency,
      items: items.rows.map((i) => ({
        item_name: i.item_name,
        sku: i.sku,
        quantity: i.quantity,
        quantity_received: i.quantity_received,
        unit_price: centsToDecimal(i.unit_price_cents),
        line_amount: centsToDecimal(i.quantity * i.unit_price_cents),
      })),
    };

    // Don't even query payments for roles that can't see them.
    if (policyFor(ctx.role).canSeePayments) {
      const pays = await ctx.db.query<{
        amount_cents: number;
        amount_paid_cents: number;
        due_date: string;
        paid_date: string | null;
        status: string;
      }>(
        `SELECT amount_cents, amount_paid_cents, due_date, paid_date, status FROM payments WHERE po_id = $1 ORDER BY due_date`,
        [po.id],
      );
      result.payments = pays.rows.map((p) => ({
        status: p.status,
        due_date: p.due_date,
        paid_date: p.paid_date,
        amount: centsToDecimal(p.amount_cents),
        amount_paid: centsToDecimal(p.amount_paid_cents),
        outstanding_amount: centsToDecimal(p.amount_cents - p.amount_paid_cents),
        overdue: p.status !== "paid" && p.due_date < ctx.today,
      }));
    }
    return result;
  },
});

function deliveryTimeliness(po: Header, today: string) {
  if (po.delivered_date) {
    const late = daysBetween(po.expected_delivery_date, po.delivered_date);
    return { state: late > 0 ? "delivered_late" : "delivered_on_time", days_late: Math.max(0, late) };
  }
  if ((po.status === "approved" || po.status === "partially_delivered") && po.expected_delivery_date < today) {
    return { state: "overdue", days_overdue: daysBetween(po.expected_delivery_date, today) };
  }
  return { state: po.status === "cancelled" ? "cancelled" : "not_due_yet" };
}
