import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { handleChat } from "@/agent/chat";
import type { MessageParam } from "@/agent/loop";
import { createConversation, loadHistory, saveMessages, selectRecentTurns, stripThinking } from "@/agent/memory";
import { appDb, closePools } from "@/db/client";
import { conversations, traces } from "@/db/schema";
import { FakeClaude, reply, text, thinking, toolUse } from "./fakeClaude";

// Tests write to the dev database; remove what they create so /logs stays clean.
const created: string[] = [];
afterAll(async () => {
  if (created.length) await appDb().delete(conversations).where(inArray(conversations.id, created));
  await closePools();
});

const user = (t: string): MessageParam => ({ role: "user", content: t });
const assistantText = (t: string): MessageParam => ({ role: "assistant", content: [{ type: "text", text: t }] });
const assistantTool = (id: string): MessageParam => ({
  role: "assistant",
  content: [
    { type: "thinking", thinking: "hmm", signature: "sig" },
    { type: "tool_use", id, name: "count_purchase_orders", input: {} },
  ],
});
const toolResult = (id: string): MessageParam => ({
  role: "user",
  content: [{ type: "tool_result", tool_use_id: id, content: "{}" }],
});

/** Turn with one tool call = 4 messages. */
const toolTurn = (n: number): MessageParam[] => [
  user(`q${n}`),
  assistantTool(`t${n}`),
  toolResult(`t${n}`),
  assistantText(`a${n}`),
];

describe("selectRecentTurns", () => {
  it("keeps whole turns within the limit, newest last", () => {
    const all = [...toolTurn(1), ...toolTurn(2), ...toolTurn(3)]; // 12 messages
    const kept = selectRecentTurns(all, 10);
    expect(kept).toHaveLength(8);
    expect(kept[0]).toEqual(user("q2"));
    expect(kept.at(-1)).toEqual(assistantText("a3"));
  });

  it("never splits a tool_use from its tool_result", () => {
    const all = [...toolTurn(1), ...toolTurn(2)];
    // A limit of 6 would cut inside turn 1 if trimming by message; by turn it keeps only turn 2.
    const kept = selectRecentTurns(all, 6);
    expect(kept).toEqual(toolTurn(2));
  });

  it("always starts with the user's question, not a tool_result", () => {
    for (let limit = 1; limit <= 12; limit++) {
      const kept = selectRecentTurns([...toolTurn(1), ...toolTurn(2), ...toolTurn(3)], limit);
      expect(kept[0]?.role).toBe("user");
      expect(typeof kept[0]?.content).toBe("string");
    }
  });

  it("keeps the latest turn even if it alone exceeds the limit", () => {
    expect(selectRecentTurns(toolTurn(1), 2)).toEqual(toolTurn(1));
  });
});

describe("stripThinking", () => {
  it("removes thinking blocks but keeps tool calls and text", () => {
    const out = stripThinking(toolTurn(1));
    const assistant = out[1]!;
    expect(assistant.content).toEqual([{ type: "tool_use", id: "t1", name: "count_purchase_orders", input: {} }]);
    expect(out).toHaveLength(4);
  });

  it("drops assistant messages that only contained thinking", () => {
    const out = stripThinking([
      user("q"),
      { role: "assistant", content: [{ type: "thinking", thinking: "x", signature: "s" }] },
    ]);
    expect(out).toEqual([user("q")]);
  });
});

describe("persistence", () => {
  it("round-trips messages and returns replay-safe history", async () => {
    const { id } = await createConversation("accounts");
    created.push(id);
    await saveMessages(id, toolTurn(1));
    await saveMessages(id, toolTurn(2));
    const history = await loadHistory(id);
    expect(history).toHaveLength(8);
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain('"thinking"');
    expect(serialized).toContain('"tool_use"');
  });
});

describe("handleChat", () => {
  it("fixes the role at creation, remembers earlier turns, and records traces", async () => {
    const client = new FakeClaude([
      reply("tool_use", thinking("plan"), toolUse("count_purchase_orders", { overdue_delivery: true })),
      reply("end_turn", text("There are 33 overdue orders.")),
      reply("end_turn", text("Follow-up answer.")),
    ]);

    const first = await handleChat({ role: "warehouse", message: "How many orders are overdue?" }, client);
    created.push(first.conversationId);
    expect(first.role).toBe("warehouse");
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0]!.summary).toContain("total_count=");

    // Client tries to escalate to admin on the second message; the stored role wins.
    const second = await handleChat(
      { conversationId: first.conversationId, role: "admin", message: "and how many of those are from ABC?" },
      client,
    );
    expect(second.role).toBe("warehouse");
    const followUpRequest = client.requests[2]!;
    expect(followUpRequest.tools?.map((t) => (t as { name: string }).name)).not.toContain("get_payment_dues");

    // The follow-up request includes the first turn's tool call (memory), minus its thinking block.
    const replay = JSON.stringify(followUpRequest.messages);
    expect(replay).toContain("overdue_delivery");
    expect(replay).toContain("There are 33 overdue orders.");
    expect(replay).not.toContain('"thinking"');

    const [conv] = await appDb().select().from(conversations).where(eq(conversations.id, first.conversationId));
    expect(conv!.role).toBe("warehouse");
    const rows = await appDb().select().from(traces).where(eq(traces.conversationId, first.conversationId));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.inputTokens).toBeGreaterThan(0);
    expect(rows[0]!.toolsCalled).toEqual([expect.objectContaining({ name: "count_purchase_orders", ok: true })]);
  });

  it("rejects unknown conversations and empty messages", async () => {
    const client = new FakeClaude([]);
    await expect(
      handleChat({ conversationId: "00000000-0000-0000-0000-000000000000", role: "admin", message: "hi" }, client),
    ).rejects.toThrow(/not found/);
    // Validation happens before a conversation is created, so nothing to clean up here.
    await expect(handleChat({ role: "admin", message: "   " }, client)).rejects.toThrow(/empty/);
  });
});
