import { describe, expect, it } from "vitest";
import type { ClaudeSettings } from "@/agent/claude";
import type { MessageParam, TurnDeps } from "@/agent/loop";
import {
  collectSupportedNumbers,
  extractNumbers,
  isSupported,
  UNVERIFIED_WARNING,
  validateAnswer,
  validationPassed,
} from "@/agent/validate";
import { runVerifiedTurn } from "@/agent/verifiedTurn";
import type { ToolContext } from "@/tools/defineTool";
import type { ToolRun } from "@/tools/index";
import { FakeClaude, reply, text, toolUse } from "./fakeClaude";

const values = (t: string) => extractNumbers(t).map((n) => n.value);
const run = (output: Record<string, unknown>, input: unknown = {}): ToolRun => ({
  name: "x",
  input,
  ok: true,
  output,
  durationMs: 1,
});

describe("extractNumbers", () => {
  it("reads plain, grouped, decimal, currency and percent numbers", () => {
    expect(values("There are 25 orders worth $12,345.67 (87.3%).")).toEqual([25, 12345.67, 87.3]);
    expect(values("Outstanding: ₹1,23,450.00 and €99")).toEqual([123450, 99]);
    expect(extractNumbers("$12,345.67")[0]).toMatchObject({ raw: "$12,345.67", decimals: 2 });
  });

  it("ignores PO numbers, dates, years and quarters", () => {
    expect(values("PO-2026-0042 was ordered on 2026-03-01")).toEqual([]);
    expect(values("Due Nov 15, 2026 or 15 November 2026 or 15/11/2026")).toEqual([]);
    expect(values("In 2026, Q4 deliveries for 2026-11")).toEqual([]);
    expect(values("Due on March 8th")).toEqual([]);
  });

  it("ignores list markers but not numbers inside list items", () => {
    expect(values("1. PO-2026-0001: 30 units\n2. PO-2026-0002: 40 units")).toEqual([30, 40]);
  });

  it("skips numbers glued to letters (names, SKUs, units)", () => {
    expect(values("Hex Bolt M12, LED High Bay 150W, Tarpaulin 6x4m, SS304")).toEqual([]);
  });

  it("keeps amounts that look like years when formatted as money", () => {
    expect(values("$2,026 and 2026.50 and $2000")).toEqual([2026, 2026.5, 2000]);
  });

  it("handles markdown bold and tables", () => {
    expect(values("**25** orders\n| PO | Qty |\n|---|---|\n| PO-2026-0001 | 430 |")).toEqual([25, 430]);
  });
});

describe("isSupported", () => {
  it("matches exactly or after rounding to the written precision", () => {
    const supported = [87.3, 972658.1, 33];
    const n = (t: string) => extractNumbers(t)[0]!;
    expect(isSupported(n("87.3%"), supported)).toBe(true);
    expect(isSupported(n("87%"), supported)).toBe(true);
    expect(isSupported(n("$972,658"), supported)).toBe(true);
    expect(isSupported(n("$972,658.10"), supported)).toBe(true);
    expect(isSupported(n("33"), supported)).toBe(true);
    expect(isSupported(n("34"), supported)).toBe(false);
    expect(isSupported(n("88%"), supported)).toBe(false);
  });
});

describe("collectSupportedNumbers", () => {
  it("collects output numbers, decimal strings, names, array lengths, inputs and the question", () => {
    const runs = [
      run(
        { total_count: 32, total_amount: "10930.60", orders: [{ item_name: "Ball Bearing 6205" }, { item_name: "x" }] },
        { limit: 3 },
      ),
    ];
    const s = collectSupportedNumbers(runs, "show the last 7 orders");
    for (const v of [32, 10930.6, 6205, 2, 3, 7]) expect(s).toContain(v);
  });

  it("includes tool results from earlier turns (follow-ups)", () => {
    const history: MessageParam[] = [
      { role: "user", content: "how many overdue?" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "count_purchase_orders", input: {} }] },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ total_count: 33 }) }],
      },
      // Prior *answers* are not a source: they could contain unverified numbers.
      { role: "assistant", content: [{ type: "text", text: "There are 999." }] },
    ];
    const s = collectSupportedNumbers([], "and of those?", history);
    expect(s).toContain(33);
    expect(s).not.toContain(999);
  });
});

describe("validateAnswer", () => {
  const supported = collectSupportedNumbers(
    [run({ total_count: 25, overdue_outstanding_amount: "26580.47", on_time_rate_pct: 35 })],
    "q",
  );

  it("verifies an answer whose numbers all come from tools", () => {
    expect(validateAnswer("25 orders, $26,580.47 overdue, 35% on time.", supported)).toEqual({
      status: "verified",
      unsupported: [],
      checked: 3,
    });
  });
  it("flags invented or self-computed numbers", () => {
    // 65% = 100 - 35 (computed by the model) and 50 (invented).
    const r = validateAnswer("35% on time, so 65% late, roughly 50 orders.", supported);
    expect(r.status).toBe("unverified");
    expect(r.unsupported).toEqual(["65%", "50"]);
  });
  it("is not applicable when the answer has no numbers", () => {
    expect(validateAnswer("Your role can't see payment data.", supported).status).toBe("not_applicable");
    expect(validationPassed("not_applicable")).toBeNull();
    expect(validationPassed("verified")).toBe(true);
    expect(validationPassed("unverified")).toBe(false);
  });
});

describe("runVerifiedTurn", () => {
  const settings: ClaudeSettings = { model: "m", effort: "medium", refusalFallback: false };
  const ctx: ToolContext = { role: "accounts", today: "2026-11-15", currency: "USD", db: {} as ToolContext["db"] };
  const runTool = async (name: string, input: unknown): Promise<ToolRun> => ({
    name,
    input,
    ok: true,
    output: { total_count: 25 },
    durationMs: 1,
  });
  const deps = (client: FakeClaude): TurnDeps => ({ client, settings, ctx, runTool });

  it("passes without retry when numbers are supported", async () => {
    const client = new FakeClaude([
      reply("tool_use", toolUse("count_purchase_orders", {})),
      reply("end_turn", text("There are 25.")),
    ]);
    const r = await runVerifiedTurn([], "how many?", deps(client));
    expect(r.validation).toMatchObject({ status: "verified", retried: false });
    expect(r.modelCalls).toBe(2);
    expect(r.messagesToSave).toEqual(r.newMessages);
  });

  it("retries once with the unsupported numbers, then saves a clean history", async () => {
    const client = new FakeClaude([
      reply("tool_use", toolUse("count_purchase_orders", {})),
      reply("end_turn", text("There are 26.")),
      reply("end_turn", text("There are 25.")),
    ]);
    const r = await runVerifiedTurn([], "how many?", deps(client));
    expect(r.answer).toBe("There are 25.");
    expect(r.validation).toMatchObject({ status: "verified", retried: true });

    // The retry request carried the nudge naming "26".
    const nudge = client.requests[2]!.messages.at(-1)!;
    expect(nudge.role).toBe("user");
    expect(JSON.stringify(nudge.content)).toContain("26");

    // Saved: question, tool_use, tool_result, corrected answer. No nudge, no rejected answer.
    const saved = JSON.stringify(r.messagesToSave);
    expect(r.messagesToSave.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(saved).not.toContain("There are 26.");
    expect(saved).not.toContain("Automatic check");
  });

  it("adds a visible warning when the retry still fails", async () => {
    const client = new FakeClaude([
      reply("end_turn", text("About 40 orders.")),
      reply("end_turn", text("Roughly 41 orders.")),
    ]);
    const r = await runVerifiedTurn([], "how many?", deps(client));
    expect(r.validation).toMatchObject({ status: "unverified", retried: true, unsupported: ["41"] });
    expect(r.answer).toContain(UNVERIFIED_WARNING);
    expect(r.messagesToSave.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("does not validate clarification turns", async () => {
    const client = new FakeClaude([
      reply("tool_use", toolUse("ask_clarification", { question: "Which of the 3 ABC suppliers?" })),
    ]);
    const clarifyRun = async (name: string, input: unknown): Promise<ToolRun> => ({
      name,
      input,
      ok: true,
      output: { asked: true, question: (input as { question: string }).question, options: [] },
      durationMs: 1,
    });
    const r = await runVerifiedTurn([], "ABC dues", { client, settings, ctx, runTool: clarifyRun });
    expect(r.outcome).toBe("clarification");
    expect(r.validation.status).toBe("not_applicable");
  });
});
