import { describe, expect, it } from "vitest";
import { checkAnswerContains, checkClarifiesWith, checkNoAmounts, checkTools } from "../evals/checks";

describe("eval checks", () => {
  it("checkTools supports alternatives and reports what's missing", () => {
    expect(
      checkTools(
        ["search_suppliers", "count_purchase_orders|list_purchase_orders"],
        ["search_suppliers", "list_purchase_orders"],
      ).ok,
    ).toBe(true);
    expect(checkTools(["get_delivery_summary"], ["count_purchase_orders"])).toEqual({
      ok: false,
      detail: "missing get_delivery_summary",
    });
    expect(checkTools([], []).ok).toBe(true);
  });

  it("checkAnswerContains matches numbers by value and text case-insensitively", () => {
    expect(checkAnswerContains("There are **25** orders.", ["25"]).ok).toBe(true);
    expect(checkAnswerContains("We owe $4,269,567.27 in total.", ["4269567.27"]).ok).toBe(true);
    expect(checkAnswerContains("On-time rate is 35%.", ["35.0"]).ok).toBe(true);
    expect(checkAnswerContains("Status: Cancelled", ["cancelled"]).ok).toBe(true);
    expect(checkAnswerContains("It is pending approval", ["pending_approval"]).ok).toBe(true);
    expect(checkAnswerContains("There are 26 orders.", ["25"]).ok).toBe(false);
    // PO numbers are text values, so the digits inside them don't count as numbers.
    expect(checkAnswerContains("PO-2026-0029 is oldest", ["PO-2026-0029"]).ok).toBe(true);
  });

  it("checkClarifiesWith looks at options and the question", () => {
    expect(
      checkClarifiesWith(["ABC Metals", "ABC Packaging"], "Or ABC Traders Pvt Ltd?", [
        "ABC Metals",
        "ABC Packaging",
        "ABC Traders Pvt Ltd",
      ]).ok,
    ).toBe(true);
    expect(checkClarifiesWith(["ABC Metals"], "Which one?", ["ABC Metals", "ABC Packaging"]).detail).toBe(
      "not offered: ABC Packaging",
    );
  });

  it("checkNoAmounts flags currency amounts only", () => {
    expect(checkNoAmounts("Your role can't see payment data. There are 3 open orders.").ok).toBe(true);
    expect(checkNoAmounts("They owe $1,234.50").ok).toBe(false);
  });
});
