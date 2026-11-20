import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/agent/roles";
import { demoToday } from "@/config";
import { appPool, closePools } from "@/db/client";
import { centsToDecimal } from "@/lib/money";
import { runTool, toolContextFor, type ToolRun } from "@/tools/index";

/**
 * Tools run through the real read-only connection. Every expected value is
 * computed by an independent SQL query on the app connection, never hardcoded,
 * so these tests stay correct if the seed changes.
 */

afterAll(() => closePools());

const today = demoToday();

async function expectedOne<T = Record<string, number>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await appPool().query(sql, params);
  return rows[0] as T;
}

async function call(name: string, input: unknown, role: Role = "accounts"): Promise<ToolRun> {
  return runTool(name, input, toolContextFor(role));
}

async function ok(name: string, input: unknown, role: Role = "accounts") {
  const run = await call(name, input, role);
  expect(run.ok, JSON.stringify(run.output)).toBe(true);
  return run.output as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test convenience
}

async function supplierIdByName(name: string): Promise<number> {
  return (await expectedOne<{ id: number }>("SELECT id FROM suppliers WHERE name = $1", [name])).id;
}

describe("search_suppliers", () => {
  it("'ABC' is ambiguous across the three ABC suppliers", async () => {
    const out = await ok("search_suppliers", { query: "ABC" });
    expect(out.ambiguous).toBe(true);
    expect(out.candidates.map((c: { name: string }) => c.name).sort()).toEqual(["ABC Metals", "ABC Packaging", "ABC Traders Pvt Ltd"]);
  });
  it("'Ganesh' is ambiguous between the two Ganesh suppliers", async () => {
    const out = await ok("search_suppliers", { query: "Ganesh" });
    expect(out.ambiguous).toBe(true);
    expect(out.candidates).toHaveLength(2);
  });
  it.each([
    ["abc traders", "ABC Traders Pvt Ltd"],
    ["Ganesh Steel", "Shree Ganesh Steel"],
    ["Shree Ganesh Stel", "Shree Ganesh Steel"],
    ["Pacfic Rim", "Pacific Rim Electronics"],
    ["ABC Metals", "ABC Metals"],
  ])("'%s' resolves to %s", async (query, name) => {
    const out = await ok("search_suppliers", { query });
    expect(out.ambiguous).toBe(false);
    expect(out.resolved.name).toBe(name);
    expect(out.resolved.supplier_id).toBe(await supplierIdByName(name));
  });
  it("unknown name returns no match", async () => {
    const out = await ok("search_suppliers", { query: "Acme Corp" });
    expect(out.resolved).toBeNull();
    expect(out.candidates).toEqual([]);
  });
  it("LIKE wildcards in input are treated literally", async () => {
    const out = await ok("search_suppliers", { query: "%%" });
    expect(out.candidates).toEqual([]);
  });
});

describe("count_purchase_orders", () => {
  it("counts pending approval", async () => {
    const exp = await expectedOne("SELECT count(*) AS n FROM purchase_orders WHERE status = 'pending_approval'");
    const out = await ok("count_purchase_orders", { status: ["pending_approval"] });
    expect(out.total_count).toBe(exp.n);
    expect(out.by_status.pending_approval).toBe(exp.n);
  });
  it("counts overdue deliveries for a supplier", async () => {
    const id = await supplierIdByName("Pacific Rim Electronics");
    const exp = await expectedOne(
      `SELECT count(*) AS n FROM purchase_orders WHERE supplier_id = $1
         AND status IN ('approved','partially_delivered') AND expected_delivery_date < $2`,
      [id, today],
    );
    const out = await ok("count_purchase_orders", { supplier_id: id, overdue_delivery: true });
    expect(out.total_count).toBe(exp.n);
  });
  it("groups by supplier, highest first", async () => {
    const exp = await expectedOne<{ name: string; n: number }>(
      `SELECT s.name, count(*) AS n FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        GROUP BY s.name ORDER BY n DESC, s.name LIMIT 1`,
    );
    const out = await ok("count_purchase_orders", { group_by: "supplier", limit: 3 });
    expect(out.by_supplier).toHaveLength(3);
    expect(out.by_supplier[0]).toMatchObject({ supplier_name: exp.name, count: exp.n });
    expect(out.suppliers_total_count).toBe(20);
  });
  it("filters by order date range", async () => {
    const exp = await expectedOne("SELECT count(*) AS n FROM purchase_orders WHERE order_date BETWEEN '2026-07-01' AND '2026-09-30'");
    const out = await ok("count_purchase_orders", { date_from: "2026-07-01", date_to: "2026-09-30" });
    expect(out.total_count).toBe(exp.n);
  });
  it("counts orders with overdue payments (accounts)", async () => {
    const exp = await expectedOne(
      `SELECT count(*) AS n FROM purchase_orders po WHERE EXISTS (
         SELECT 1 FROM payments p WHERE p.po_id = po.id AND p.status <> 'paid' AND p.due_date < $1)`,
      [today],
    );
    const out = await ok("count_purchase_orders", { payment_overdue: true });
    expect(out.total_count).toBe(exp.n);
  });
  it("rejects reversed date ranges", async () => {
    const run = await call("count_purchase_orders", { date_from: "2026-10-01", date_to: "2026-01-01" });
    expect(run).toMatchObject({ ok: false, errorCode: "invalid_input" });
  });
});

describe("list_purchase_orders", () => {
  it("returns total_count with a limited page, newest first", async () => {
    const id = await supplierIdByName("ABC Traders Pvt Ltd");
    const exp = await expectedOne<{ n: number; latest: string }>(
      "SELECT count(*) AS n, max(po_number) AS latest FROM purchase_orders WHERE supplier_id = $1",
      [id],
    );
    const out = await ok("list_purchase_orders", { supplier_id: id, limit: 5 });
    expect(out.total_count).toBe(exp.n);
    expect(out.returned).toBe(5);
    expect(out.orders[0].po_number).toBe(exp.latest);
    expect(out.orders[0].total_amount).toMatch(/^\d+\.\d{2}$/);
  });
  it("caps limit at 50", async () => {
    const run = await call("list_purchase_orders", { limit: 51 });
    expect(run).toMatchObject({ ok: false, errorCode: "invalid_input" });
  });
  it("sorts by amount for accounts", async () => {
    const exp = await expectedOne<{ c: number }>("SELECT max(total_amount_cents) AS c FROM purchase_orders");
    const out = await ok("list_purchase_orders", { sort: "total_amount_desc", limit: 1 });
    expect(out.orders[0].total_amount).toBe(centsToDecimal(exp.c));
  });
});

describe("get_purchase_order_details", () => {
  it("returns header, items and payments; input is normalized", async () => {
    const po = await expectedOne<{ id: number; total: number; items: number; pays: number }>(
      `SELECT po.id, po.total_amount_cents AS total,
              (SELECT count(*) FROM po_items WHERE po_id = po.id) AS items,
              (SELECT count(*) FROM payments WHERE po_id = po.id) AS pays
         FROM purchase_orders po WHERE po_number = 'PO-2026-0100'`,
    );
    const out = await ok("get_purchase_order_details", { po_number: " po-2026-0100 " });
    expect(out.found).toBe(true);
    expect(out.total_amount).toBe(centsToDecimal(po.total));
    expect(out.items).toHaveLength(po.items);
    expect(out.payments).toHaveLength(po.pays);
  });
  it("reports a missing PO without erroring", async () => {
    const out = await ok("get_purchase_order_details", { po_number: "PO-2030-9999" });
    expect(out.found).toBe(false);
  });
  it("rejects malformed PO numbers", async () => {
    const run = await call("get_purchase_order_details", { po_number: "42" });
    expect(run).toMatchObject({ ok: false, errorCode: "invalid_input" });
  });
});

describe("get_supplier_summary", () => {
  it("matches SQL totals and on-time rate", async () => {
    const id = await supplierIdByName("Shree Ganesh Steel");
    const exp = await expectedOne<{ n: number; value: number; on_time: number; late: number }>(
      `SELECT count(*) AS n,
              coalesce(sum(total_amount_cents) FILTER (WHERE status <> 'cancelled'), 0)::bigint AS value,
              count(*) FILTER (WHERE delivered_date <= expected_delivery_date) AS on_time,
              count(*) FILTER (WHERE delivered_date > expected_delivery_date) AS late
         FROM purchase_orders WHERE supplier_id = $1`,
      [id],
    );
    const out = await ok("get_supplier_summary", { supplier_id: id });
    expect(out.total_orders).toBe(exp.n);
    expect(out.total_amount).toBe(centsToDecimal(exp.value));
    expect(out.delivered_on_time).toBe(exp.on_time);
    expect(out.delivered_late).toBe(exp.late);
    expect(out.on_time_delivery_rate_pct).toBe(Math.round((exp.on_time / (exp.on_time + exp.late)) * 1000) / 10);
  });
  it("handles an unknown supplier id", async () => {
    const out = await ok("get_supplier_summary", { supplier_id: 9999 });
    expect(out.found).toBe(false);
  });
});

describe("get_payment_dues", () => {
  it("matches SQL outstanding and overdue totals", async () => {
    const exp = await expectedOne<{ n: number; outstanding: number; overdue_n: number; overdue: number }>(
      `SELECT count(*) AS n, sum(p.amount_cents - p.amount_paid_cents)::bigint AS outstanding,
              count(*) FILTER (WHERE p.due_date < $1) AS overdue_n,
              coalesce(sum(p.amount_cents - p.amount_paid_cents) FILTER (WHERE p.due_date < $1), 0)::bigint AS overdue
         FROM payments p JOIN purchase_orders po ON po.id = p.po_id
        WHERE p.status <> 'paid' AND po.status <> 'cancelled'`,
      [today],
    );
    const out = await ok("get_payment_dues", {});
    expect(out.total_count).toBe(exp.n);
    expect(out.total_outstanding_amount).toBe(centsToDecimal(exp.outstanding));
    expect(out.overdue_count).toBe(exp.overdue_n);
    expect(out.overdue_outstanding_amount).toBe(centsToDecimal(exp.overdue));
  });
  it("overdue_only for one supplier returns the oldest overdue first", async () => {
    const id = await supplierIdByName("ABC Traders Pvt Ltd");
    const exp = await expectedOne<{ n: number; oldest: string }>(
      `SELECT count(*) AS n, min(p.due_date) AS oldest FROM payments p JOIN purchase_orders po ON po.id = p.po_id
        WHERE po.supplier_id = $1 AND p.status <> 'paid' AND p.due_date < $2 AND po.status <> 'cancelled'`,
      [id, today],
    );
    const out = await ok("get_payment_dues", { supplier_id: id, overdue_only: true });
    expect(out.total_count).toBe(exp.n);
    expect(out.oldest_overdue?.due_date ?? null).toBe(exp.oldest);
  });
});

describe("get_delivery_summary", () => {
  const q4 = { date_from: "2026-10-01", date_to: "2026-12-31" };

  it("matches SQL delivered and late counts for the quarter", async () => {
    const exp = await expectedOne(
      `SELECT count(*) AS delivered, count(*) FILTER (WHERE delivered_date > expected_delivery_date) AS late
         FROM purchase_orders WHERE status = 'delivered' AND delivered_date BETWEEN $1 AND $2`,
      [q4.date_from, q4.date_to],
    );
    const out = await ok("get_delivery_summary", q4, "warehouse");
    expect(out.delivered).toBe(exp.delivered);
    expect(out.delivered_late).toBe(exp.late);
  });
  it("ranks suppliers by late deliveries", async () => {
    const exp = await expectedOne<{ name: string; late: number }>(
      `SELECT s.name, count(*) AS late FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.status = 'delivered' AND po.delivered_date BETWEEN $1 AND $2 AND po.delivered_date > po.expected_delivery_date
        GROUP BY s.name ORDER BY late DESC, s.name LIMIT 1`,
      [q4.date_from, q4.date_to],
    );
    const out = await ok("get_delivery_summary", { ...q4, group_by: "supplier", limit: 3 }, "warehouse");
    expect(out.by_supplier[0]).toMatchObject({ supplier_name: exp.name, delivered_late: exp.late });
    expect(out.by_supplier).toHaveLength(3);
  });
  it("requires a period", async () => {
    const run = await call("get_delivery_summary", {});
    expect(run).toMatchObject({ ok: false, errorCode: "invalid_input" });
  });
});

describe("ask_clarification", () => {
  it("echoes the question and options", async () => {
    const out = await ok("ask_clarification", { question: "Which ABC?", options: ["ABC Metals", "ABC Packaging"] });
    expect(out).toEqual({ asked: true, question: "Which ABC?", options: ["ABC Metals", "ABC Packaging"] });
  });
});

describe("permissions (layer 2: inside the tools)", () => {
  it("warehouse cannot call get_payment_dues even if it tries", async () => {
    const run = await call("get_payment_dues", {}, "warehouse");
    expect(run).toMatchObject({ ok: false, errorCode: "permission_denied" });
  });
  it("warehouse cannot filter by payment state", async () => {
    const run = await call("count_purchase_orders", { payment_overdue: true }, "warehouse");
    expect(run).toMatchObject({ ok: false, errorCode: "permission_denied" });
  });
  it("warehouse cannot sort by amount", async () => {
    const run = await call("list_purchase_orders", { sort: "total_amount_desc" }, "warehouse");
    expect(run).toMatchObject({ ok: false, errorCode: "permission_denied" });
  });
  it("warehouse sees PO details without any amounts or payments", async () => {
    const out = await ok("get_purchase_order_details", { po_number: "PO-2026-0100" }, "warehouse");
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/"(total_amount|unit_price|line_amount|amount|payments)"/);
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.hidden_for_your_role).toBeDefined();
  });
  it("warehouse supplier summary omits total value", async () => {
    const out = await ok("get_supplier_summary", { supplier_id: 1 }, "warehouse");
    expect(out.total_amount).toBeUndefined();
    expect(out.total_orders).toBeGreaterThan(0);
  });
  it("unknown tools are rejected", async () => {
    const run = await call("drop_all_tables", {});
    expect(run).toMatchObject({ ok: false, errorCode: "unknown_tool" });
  });
});
