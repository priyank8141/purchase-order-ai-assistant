import { afterAll, describe, expect, it } from "vitest";
import { demoCurrency, demoToday } from "@/config";
import { appPool, closePools, readonlyPool } from "@/db/client";
import { generateSeedData, ORDER_COUNT } from "@/db/generateSeed";

afterAll(() => closePools());

describe("seed generator", () => {
  it("is deterministic", () => {
    const a = generateSeedData("2026-11-15", "USD");
    const b = generateSeedData("2026-11-15", "USD");
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("produces the required shape", () => {
    const d = generateSeedData("2026-11-15", "USD");
    expect(d.suppliers).toHaveLength(20);
    expect(d.orders).toHaveLength(ORDER_COUNT);
    const names = d.suppliers.map((s) => s.name);
    for (const n of ["ABC Traders Pvt Ltd", "ABC Metals", "ABC Packaging", "Shree Ganesh Steel", "Ganesh Industries"]) {
      expect(names).toContain(n);
    }
    // PO number year matches the order date year.
    for (const o of d.orders) expect(o.poNumber.slice(3, 7)).toBe(o.orderDate.slice(0, 4));
  });
});

describe("seeded database", () => {
  it("order totals equal the sum of their items", async () => {
    const { rows } = await appPool().query(`
      SELECT count(*)::int AS mismatches FROM purchase_orders po
      JOIN (SELECT po_id, sum(quantity * unit_price_cents) AS s FROM po_items GROUP BY po_id) i ON i.po_id = po.id
      WHERE i.s <> po.total_amount_cents`);
    expect(rows[0].mismatches).toBe(0);
  });

  it("contains overdue payments and late deliveries", async () => {
    const today = demoToday();
    const overdue = await appPool().query(
      "SELECT count(*)::int AS n FROM payments WHERE status <> 'paid' AND due_date < $1",
      [today],
    );
    const late = await appPool().query(
      "SELECT count(*)::int AS n FROM purchase_orders WHERE delivered_date > expected_delivery_date",
    );
    expect(overdue.rows[0].n).toBeGreaterThan(0);
    expect(late.rows[0].n).toBeGreaterThan(0);
  });

  it("uses a single currency", async () => {
    const { rows } = await appPool().query("SELECT DISTINCT currency FROM purchase_orders");
    expect(rows).toEqual([{ currency: demoCurrency() }]);
  });
});

describe("agent_readonly role", () => {
  it("can read the four ERP tables", async () => {
    for (const t of ["suppliers", "purchase_orders", "po_items", "payments"]) {
      const { rows } = await readonlyPool().query(`SELECT count(*)::int AS n FROM ${t}`);
      expect(rows[0].n).toBeGreaterThan(0);
    }
  });

  it("can use pg_trgm similarity", async () => {
    const { rows } = await readonlyPool().query(
      "SELECT name FROM suppliers ORDER BY similarity(name, $1) DESC LIMIT 1",
      ["Shree Ganesh Stel"],
    );
    expect(rows[0].name).toBe("Shree Ganesh Steel");
  });

  it("cannot write", async () => {
    await expect(readonlyPool().query("UPDATE suppliers SET city = 'X' WHERE id = 1")).rejects.toThrow();
    await expect(
      readonlyPool().query("INSERT INTO suppliers (name, code, city, country, category) VALUES ('x','x','x','x','x')"),
    ).rejects.toThrow();
  });

  it("cannot read app tables", async () => {
    for (const t of ["conversations", "messages", "traces"]) {
      await expect(readonlyPool().query(`SELECT 1 FROM ${t} LIMIT 1`)).rejects.toThrow(/permission denied/);
    }
  });

  it("runs transactions read-only by default", async () => {
    const { rows } = await readonlyPool().query("SHOW default_transaction_read_only");
    expect(rows[0].default_transaction_read_only).toBe("on");
  });
});
