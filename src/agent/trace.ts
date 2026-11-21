import { appDb } from "../db/client";
import { traces } from "../db/schema";
import type { ToolRun } from "../tools/index";
import type { Usage } from "./loop";

export interface ToolCallTrace {
  name: string;
  input: unknown;
  ok: boolean;
  summary: string;
  duration_ms: number;
}

/** A one-line, human-readable description of a tool result for the trace and the "How I got this" panel. */
export function summarizeToolRun(run: ToolRun): string {
  const o = run.output;
  if (!run.ok) return `${String(o.error)}: ${String(o.message ?? "")}`.slice(0, 200);
  const parts: string[] = [];
  for (const key of ["total_count", "returned", "ambiguous", "found", "total_orders", "delivered", "delivered_late", "overdue_count"]) {
    if (key in o) parts.push(`${key}=${JSON.stringify(o[key])}`);
  }
  if (o.resolved && typeof o.resolved === "object") parts.push(`resolved=${String((o.resolved as { name?: string }).name)}`);
  if (Array.isArray(o.candidates) && o.ambiguous) parts.push(`candidates=${o.candidates.length}`);
  if (o.asked) parts.push(`asked="${String(o.question)}"`);
  return parts.join(", ") || "ok";
}

export function toToolCallTraces(runs: ToolRun[]): ToolCallTrace[] {
  return runs.map((r) => ({ name: r.name, input: r.input, ok: r.ok, summary: summarizeToolRun(r), duration_ms: r.durationMs }));
}

export interface TraceRecord {
  conversationId: string;
  question: string;
  toolCalls: ToolCallTrace[];
  answer: string | null;
  usage: Usage;
  latencyMs: number;
  validationPassed: boolean | null;
  error?: string;
}

export async function recordTrace(t: TraceRecord): Promise<number> {
  const [row] = await appDb()
    .insert(traces)
    .values({
      conversationId: t.conversationId,
      userQuestion: t.question,
      toolsCalled: t.toolCalls,
      finalAnswer: t.answer,
      // Cached tokens are still input tokens; count them so totals reflect real usage.
      inputTokens: t.usage.inputTokens + t.usage.cacheReadTokens + t.usage.cacheWriteTokens,
      outputTokens: t.usage.outputTokens,
      latencyMs: t.latencyMs,
      validationPassed: t.validationPassed,
      error: t.error ?? null,
    })
    .returning({ id: traces.id });
  return row!.id;
}
