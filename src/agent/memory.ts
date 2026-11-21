import type Anthropic from "@anthropic-ai/sdk";
import { asc, eq } from "drizzle-orm";
import { appDb } from "../db/client";
import { conversations, messages } from "../db/schema";
import type { MessageParam } from "./loop";
import type { Role } from "./roles";

export const HISTORY_MESSAGE_LIMIT = 20;

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/** A turn starts at a user message carrying the user's own text (not just tool_result blocks). */
export function isTurnStart(m: MessageParam): boolean {
  if (m.role !== "user") return false;
  if (typeof m.content === "string") return true;
  return m.content.some((b) => b.type === "text");
}

/** Splits a conversation into whole turns. Anything before the first turn start is discarded as malformed. */
export function splitTurns(all: MessageParam[]): MessageParam[][] {
  const turns: MessageParam[][] = [];
  for (const m of all) {
    if (isTurnStart(m)) turns.push([m]);
    else turns.at(-1)?.push(m);
  }
  return turns;
}

/**
 * Keeps the most recent whole turns that fit in `limit` messages. Trimming by
 * turn (never by raw message) guarantees a tool_use is never separated from its
 * tool_result and the history always starts with a user question. The latest
 * turn is always kept, even if it alone exceeds the limit.
 */
export function selectRecentTurns(all: MessageParam[], limit = HISTORY_MESSAGE_LIMIT): MessageParam[] {
  const turns = splitTurns(all);
  const kept: MessageParam[][] = [];
  let count = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    if (kept.length > 0 && count + turn.length > limit) break;
    kept.unshift(turn);
    count += turn.length;
  }
  return kept.flat();
}

/**
 * Removes thinking blocks from earlier turns before replaying them.
 * Why: on current models a thinking block is bound to the exact history that
 * preceded it. Once we trim old turns, that history changes and the API would
 * reject the block. Text, tool_use and tool_result stay, so follow-ups like
 * "how many of those are overdue?" still see the earlier tool calls.
 * (Thinking within the *current* turn is passed back untouched by the loop.)
 */
export function stripThinking(history: MessageParam[]): MessageParam[] {
  const out: MessageParam[] = [];
  for (const m of history) {
    if (m.role !== "assistant" || typeof m.content === "string") {
      out.push(m);
      continue;
    }
    const content = m.content.filter((b: ContentBlock) => b.type !== "thinking" && b.type !== "redacted_thinking");
    if (content.length > 0) out.push({ role: "assistant", content });
  }
  return out;
}

export function prepareHistory(all: MessageParam[], limit = HISTORY_MESSAGE_LIMIT): MessageParam[] {
  return stripThinking(selectRecentTurns(all, limit));
}

// ---------------------------------------------------------------------------
// Persistence (app connection, never the agent's read-only one)
// ---------------------------------------------------------------------------

export async function createConversation(role: Role): Promise<{ id: string; role: Role }> {
  const [row] = await appDb().insert(conversations).values({ role }).returning();
  return { id: row!.id, role: row!.role };
}

export async function getConversation(id: string): Promise<{ id: string; role: Role } | null> {
  const [row] = await appDb().select().from(conversations).where(eq(conversations.id, id));
  return row ? { id: row.id, role: row.role } : null;
}

/** Loads the conversation and returns the trimmed, replay-safe history. */
export async function loadHistory(conversationId: string): Promise<MessageParam[]> {
  // Loading the whole conversation is fine at demo scale and keeps trimming
  // logic in one tested function. A production version would page from the end.
  const rows = await appDb()
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.id));
  // Rows were written by saveMessages from validated MessageParam values.
  return prepareHistory(rows.map((r) => ({ role: r.role, content: r.content }) as MessageParam));
}

export async function saveMessages(conversationId: string, turn: MessageParam[]): Promise<void> {
  if (turn.length === 0) return;
  await appDb()
    .insert(messages)
    .values(turn.map((m) => ({ conversationId, role: m.role, content: m.content })));
}
