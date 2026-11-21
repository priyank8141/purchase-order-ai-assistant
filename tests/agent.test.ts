import { afterAll, describe, expect, it } from "vitest";
import type { ClaudeSettings } from "@/agent/claude";
import { MAX_TOOL_ROUNDS, runAgentTurn, TOOL_LIMIT_MESSAGE, type MessageParam, type TurnDeps } from "@/agent/loop";
import { dateRanges } from "@/agent/systemPrompt";
import { closePools } from "@/db/client";
import type { ToolContext } from "@/tools/defineTool";
import type { ToolRun } from "@/tools/index";
import { FakeClaude, reply, text, thinking, toolUse } from "./fakeClaude";

afterAll(() => closePools());

const settings: ClaudeSettings = { model: "test-model", effort: "medium", refusalFallback: false };
const ctx = (role: ToolContext["role"] = "accounts"): ToolContext => ({
  role,
  today: "2026-11-15",
  currency: "USD",
  db: { query: async () => ({ rows: [] }) } as unknown as ToolContext["db"],
});

/** Stub tool runner: records calls, returns a canned result (or an error for names starting with "fail"). */
function stubRunner() {
  const calls: string[] = [];
  const runTool = async (name: string, input: unknown): Promise<ToolRun> => {
    calls.push(name);
    if (name === "ask_clarification") {
      const i = input as { question: string; options?: string[] };
      return { name, input, ok: true, output: { asked: true, question: i.question, options: i.options ?? [] }, durationMs: 1 };
    }
    if (name.startsWith("fail")) return { name, input, ok: false, output: { error: "invalid_input", message: "bad" }, durationMs: 1 };
    return { name, input, ok: true, output: { total_count: 7 }, durationMs: 1 };
  };
  return { calls, runTool };
}

function deps(client: FakeClaude, role: ToolContext["role"] = "accounts") {
  const stub = stubRunner();
  const d: TurnDeps = { client, settings, ctx: ctx(role), runTool: stub.runTool };
  return { d, calls: stub.calls };
}

/** Every tool_use id in assistant messages must have a matching tool_result right after. */
function assertPairsIntact(messages: MessageParam[]) {
  messages.forEach((m, i) => {
    if (m.role !== "assistant" || typeof m.content === "string") return;
    const ids = m.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []));
    if (ids.length === 0) return;
    const next = messages[i + 1];
    expect(next?.role).toBe("user");
    const resultIds = typeof next!.content === "string" ? [] : next!.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []));
    expect(resultIds.sort()).toEqual([...ids].sort());
  });
}

describe("agent loop", () => {
  it("runs a tool round, feeds results back, and returns the final text", async () => {
    const client = new FakeClaude([
      reply("tool_use", thinking("plan"), toolUse("count_purchase_orders", { status: ["pending_approval"] })),
      reply("end_turn", text("There are 7 orders pending approval.")),
    ]);
    const { d, calls } = deps(client);
    const r = await runAgentTurn({ history: [], question: "How many pending approval?" }, d);

    expect(r.outcome).toBe("answered");
    expect(r.answer).toBe("There are 7 orders pending approval.");
    expect(calls).toEqual(["count_purchase_orders"]);
    expect(r.modelCalls).toBe(2);
    expect(r.usage).toEqual({ inputTokens: 200, outputTokens: 40, cacheReadTokens: 100, cacheWriteTokens: 0 });
    // user, assistant(tool_use), user(tool_result), assistant(text)
    expect(r.newMessages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    assertPairsIntact(r.newMessages);

    // The second request carries the current turn's thinking block back unchanged.
    const second = client.requests[1]!;
    const assistant = second.messages[1]!;
    expect(Array.isArray(assistant.content) && assistant.content[0]).toMatchObject({ type: "thinking", thinking: "plan" });
  });

  it("returns all parallel tool results in ONE user message, with is_error on failures", async () => {
    const client = new FakeClaude([
      reply("tool_use", toolUse("search_suppliers", { query: "x" }), toolUse("fail_tool", {})),
      reply("end_turn", text("done")),
    ]);
    const { d } = deps(client);
    const r = await runAgentTurn({ history: [], question: "q" }, d);
    const results = r.newMessages[2]!;
    expect(results.role).toBe("user");
    const blocks = results.content as Array<{ type: string; is_error?: boolean }>;
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.is_error)).toEqual([false, true]);
    expect(r.toolRuns.map((t) => t.ok)).toEqual([true, false]);
  });

  it(`stops after ${MAX_TOOL_ROUNDS} tool rounds with a friendly message and valid history`, async () => {
    const script = Array.from({ length: MAX_TOOL_ROUNDS + 1 }, () => reply("tool_use", toolUse("count_purchase_orders", {})));
    const client = new FakeClaude(script);
    const { d, calls } = deps(client);
    const r = await runAgentTurn({ history: [], question: "loop forever" }, d);
    expect(r.outcome).toBe("tool_limit");
    expect(r.answer).toBe(TOOL_LIMIT_MESSAGE);
    expect(calls).toHaveLength(MAX_TOOL_ROUNDS);
    expect(r.modelCalls).toBe(MAX_TOOL_ROUNDS + 1);
    assertPairsIntact(r.newMessages);
    expect(r.newMessages.at(-1)?.role).toBe("assistant");
  });

  it("ends the turn on ask_clarification without calling Claude again", async () => {
    const client = new FakeClaude([
      reply("tool_use", toolUse("ask_clarification", { question: "Which ABC supplier?", options: ["ABC Metals", "ABC Packaging"] })),
    ]);
    const { d } = deps(client);
    const r = await runAgentTurn({ history: [], question: "Show overdue payments for ABC" }, d);
    expect(r.outcome).toBe("clarification");
    expect(r.clarification).toEqual({ question: "Which ABC supplier?", options: ["ABC Metals", "ABC Packaging"] });
    expect(r.modelCalls).toBe(1);
    assertPairsIntact(r.newMessages);
    expect(r.newMessages.at(-1)).toEqual({ role: "assistant", content: [{ type: "text", text: "Which ABC supplier?" }] });
  });

  it("handles a refusal", async () => {
    const client = new FakeClaude([reply("refusal")]);
    const { d } = deps(client);
    const r = await runAgentTurn({ history: [], question: "q" }, d);
    expect(r.outcome).toBe("refusal");
    expect(r.answer.length).toBeGreaterThan(0);
  });

  it("sends only the role's tools, cached system prompt, history, and settings", async () => {
    const history: MessageParam[] = [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: [{ type: "text", text: "earlier answer" }] },
    ];
    const client = new FakeClaude([reply("end_turn", text("ok"))]);
    const { d } = deps(client, "warehouse");
    await runAgentTurn({ history, question: "new question" }, d);
    const req = client.requests[0]!;
    expect(req.model).toBe("test-model");
    expect(req.output_config?.effort).toBe("medium");
    expect(req.tools?.map((t) => (t as { name: string }).name)).not.toContain("get_payment_dues");
    const system = req.system as Array<{ text: string; cache_control?: unknown }>;
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(system[0]!.text).toContain("Today is 2026-11-15");
    expect(system[0]!.text).toContain("Warehouse");
    expect(req.messages).toHaveLength(3);
    expect(req.messages[2]).toEqual({ role: "user", content: "new question" });
  });
});

describe("system prompt date ranges", () => {
  it("computes month and quarter boundaries", () => {
    expect(dateRanges("2026-11-15")).toMatchObject({
      monthStart: "2026-11-01",
      monthEnd: "2026-11-30",
      lastMonthStart: "2026-10-01",
      lastMonthEnd: "2026-10-31",
      quarterStart: "2026-10-01",
      quarterEnd: "2026-12-31",
      lastQuarterStart: "2026-07-01",
      lastQuarterEnd: "2026-09-30",
      last30: "2026-10-16",
    });
  });
  it("handles year boundaries", () => {
    expect(dateRanges("2026-02-10")).toMatchObject({
      lastMonthStart: "2026-01-01",
      lastQuarterStart: "2025-10-01",
      lastQuarterEnd: "2025-12-31",
      monthEnd: "2026-02-28",
    });
  });
});
