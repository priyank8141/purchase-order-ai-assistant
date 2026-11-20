import { describe, expect, it } from "vitest";
import { canUseTool, ROLES } from "@/agent/roles";
import { addDays, daysBetween } from "@/lib/dates";
import { centsToDecimal, formatMoney } from "@/lib/money";
import { isoDate } from "@/tools/common";
import { toolDefinitionsForRole } from "@/tools/index";
import { HIDDEN_NOTE_KEY, redactForRole } from "@/tools/redact";
import { escapeLike, pct } from "@/tools/sql";
import { resolveSupplierMatch, type SupplierCandidate } from "@/tools/supplierMatch";

const c = (id: number, score: number, exact = false): SupplierCandidate => ({ id, name: `S${id}`, city: "X", score, exact });

describe("resolveSupplierMatch", () => {
  it("exact name match wins even when others score equally", () => {
    const r = resolveSupplierMatch([c(1, 1), c(2, 1, true)]);
    expect(r).toMatchObject({ status: "resolved", supplier: { id: 2 } });
  });
  it("single plausible candidate resolves", () => {
    expect(resolveSupplierMatch([c(1, 0.64)])).toMatchObject({ status: "resolved", supplier: { id: 1 } });
  });
  it("clear lead resolves", () => {
    expect(resolveSupplierMatch([c(1, 1), c(2, 0.54)])).toMatchObject({ status: "resolved", supplier: { id: 1 } });
  });
  it("close scores are ambiguous and list only the close ones", () => {
    const r = resolveSupplierMatch([c(1, 1), c(2, 0.95), c(3, 0.4)]);
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.map((x) => x.id)).toEqual([1, 2]);
  });
  it("noise only is none", () => {
    expect(resolveSupplierMatch([c(1, 0.2)]).status).toBe("none");
    expect(resolveSupplierMatch([]).status).toBe("none");
  });
});

describe("redactForRole", () => {
  const data = {
    po_number: "PO-2026-0001",
    total_amount: "10.00",
    items: [{ sku: "A", unit_price: "1.00", line_amount: "10.00", quantity: 10 }],
    payments: [{ amount: "10.00" }],
  };
  it("strips money and payment keys for warehouse and adds a note", () => {
    const r = redactForRole(data, "warehouse");
    expect(r).toEqual({
      po_number: "PO-2026-0001",
      items: [{ sku: "A", quantity: 10 }],
      [HIDDEN_NOTE_KEY]: expect.any(String),
    });
  });
  it("leaves data untouched for accounts and admin", () => {
    expect(redactForRole(data, "accounts")).toEqual(data);
    expect(redactForRole(data, "admin")).toEqual(data);
  });
  it("adds no note when nothing was hidden", () => {
    expect(redactForRole({ total_count: 3 }, "warehouse")).toEqual({ total_count: 3 });
  });
});

describe("roles and tool definitions", () => {
  it("warehouse never receives get_payment_dues", () => {
    const names = toolDefinitionsForRole("warehouse").map((t) => t.name);
    expect(names).not.toContain("get_payment_dues");
    expect(canUseTool("warehouse", "get_payment_dues")).toBe(false);
  });
  it("accounts and admin receive every tool", () => {
    expect(toolDefinitionsForRole("accounts")).toHaveLength(8);
    expect(toolDefinitionsForRole("admin")).toHaveLength(8);
  });
  it("definitions are object schemas with one cache breakpoint on the last tool", () => {
    for (const role of ROLES) {
      const defs = toolDefinitionsForRole(role);
      for (const d of defs) {
        expect(d.input_schema.type).toBe("object");
        expect(d.description?.length).toBeGreaterThan(50);
      }
      expect(defs.filter((d) => d.cache_control)).toHaveLength(1);
      expect(defs.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    }
  });
  it("definitions are deterministic (stable prompt cache)", () => {
    expect(JSON.stringify(toolDefinitionsForRole("accounts"))).toBe(JSON.stringify(toolDefinitionsForRole("accounts")));
  });
});

describe("helpers", () => {
  it("centsToDecimal uses exact integer math", () => {
    expect(centsToDecimal(1234567)).toBe("12345.67");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(-5)).toBe("-0.05");
    expect(centsToDecimal(0)).toBe("0.00");
    expect(() => centsToDecimal(1.5)).toThrow();
  });
  it("formatMoney formats for display", () => {
    expect(formatMoney("12345.67", "USD")).toBe("$12,345.67");
  });
  it("date helpers work in UTC", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(daysBetween("2026-03-08", "2026-11-15")).toBe(252);
  });
  it("isoDate rejects impossible dates", () => {
    expect(isoDate.safeParse("2026-11-15").success).toBe(true);
    expect(isoDate.safeParse("2026-02-30").success).toBe(false);
    expect(isoDate.safeParse("2026-13-01").success).toBe(false);
    expect(isoDate.safeParse("15/11/2026").success).toBe(false);
  });
  it("escapeLike and pct", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(pct(7, 20)).toBe(35);
    expect(pct(2, 3)).toBe(66.7);
    expect(pct(1, 0)).toBeNull();
  });
});
