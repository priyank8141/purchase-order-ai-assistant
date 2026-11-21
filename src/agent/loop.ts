import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../tools/defineTool";
import { runTool as defaultRunTool, TERMINAL_TOOLS, toolDefinitionsForRole, type ToolRun } from "../tools/index";
import { isToolName } from "../tools/names";
import { baseRequest, type ClaudeClient, type ClaudeSettings, type Message } from "./claude";
import { buildSystemPrompt } from "./systemPrompt";

// Conversation history only ever holds user and assistant messages.
export type MessageParam = Anthropic.Beta.BetaUserMessageParam | Anthropic.Beta.BetaAssistantMessageParam;
type ToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
type ToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;

/** Max rounds of tool execution per user question. */
export const MAX_TOOL_ROUNDS = 5;
const MAX_TOKENS = 16_000;

export const TOOL_LIMIT_MESSAGE =
  "Sorry, I couldn't get to an answer within the allowed number of lookups. Could you ask a more specific question?";
export const REFUSAL_MESSAGE = "Sorry, I can't help with that request.";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Clarification {
  question: string;
  options: string[];
}

export type TurnOutcome = "answered" | "clarification" | "tool_limit" | "refusal" | "max_tokens";

export interface TurnResult {
  outcome: TurnOutcome;
  /** Text to show the user (the clarifying question for clarification turns). */
  answer: string;
  clarification?: Clarification;
  /** Every message produced this turn, starting with the user's question. Persist all of them. */
  newMessages: MessageParam[];
  toolRuns: ToolRun[];
  usage: Usage;
  modelCalls: number;
}

export interface TurnDeps {
  client: ClaudeClient;
  settings: ClaudeSettings;
  ctx: ToolContext;
  runTool?: typeof defaultRunTool;
}

export interface TurnInput {
  /** Earlier turns, already trimmed and made replay-safe by memory.ts. */
  history: MessageParam[];
  question: string;
}

/**
 * One user question -> one answer. Calls Claude, runs every requested tool,
 * feeds results back, and repeats while stop_reason is "tool_use", up to
 * MAX_TOOL_ROUNDS. Tool failures are returned to Claude as is_error results
 * so it can recover; they never throw out of the loop.
 */
export async function runAgentTurn({ history, question }: TurnInput, deps: TurnDeps): Promise<TurnResult> {
  const newMessages: MessageParam[] = [{ role: "user", content: question }];
  return continueTurn(history, newMessages, deps);
}

/**
 * Continues a turn whose messages so far are `turnMessages` (which must end in a
 * user message). Exposed so validation can append a correction and resume.
 */
export async function continueTurn(
  history: MessageParam[],
  turnMessages: MessageParam[],
  deps: TurnDeps,
): Promise<TurnResult> {
  const { client, settings, ctx } = deps;
  const runTool = deps.runTool ?? defaultRunTool;
  const system = buildSystemPrompt(ctx.role, ctx.today, ctx.currency);
  const tools = toolDefinitionsForRole(ctx.role);

  const newMessages = [...turnMessages];
  const toolRuns: ToolRun[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let modelCalls = 0;
  let toolRounds = 0;

  const finish = (outcome: TurnOutcome, answer: string, clarification?: Clarification): TurnResult => ({
    outcome,
    answer,
    clarification,
    newMessages,
    toolRuns,
    usage,
    modelCalls,
  });

  for (;;) {
    const response: Message = await client.createMessage({
      ...baseRequest(settings),
      max_tokens: MAX_TOKENS,
      // Cache breakpoints: end of tools (set in toolDefinitionsForRole) and end of system.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages: [...history, ...newMessages],
    });
    modelCalls++;
    addUsage(usage, response.usage);
    // Keep the full content (thinking, tool_use, fallback blocks): the API needs it back unchanged.
    newMessages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });

    if (response.stop_reason === "refusal") return finish("refusal", textOf(response) || REFUSAL_MESSAGE);
    if (response.stop_reason !== "tool_use") {
      const text = textOf(response);
      if (response.stop_reason === "max_tokens")
        return finish("max_tokens", `${text}\n\n(The answer was cut off.)`.trim());
      return finish("answered", text);
    }

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

    if (toolRounds >= MAX_TOOL_ROUNDS) {
      // Every tool_use must get a tool_result, or the stored history is invalid for the next turn.
      newMessages.push({
        role: "user",
        content: toolUses.map((t) => errorResult(t.id, "Tool limit reached for this question.")),
      });
      newMessages.push({ role: "assistant", content: [{ type: "text", text: TOOL_LIMIT_MESSAGE }] });
      return finish("tool_limit", TOOL_LIMIT_MESSAGE);
    }
    toolRounds++;

    // Run this round's tools concurrently, then return ALL results in ONE user message.
    const runs = await Promise.all(toolUses.map((t) => runTool(t.name, t.input, ctx)));
    toolRuns.push(...runs);
    newMessages.push({
      role: "user",
      content: toolUses.map((t, i): ToolResultBlockParam => {
        const run = runs[i]!;
        return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(run.output), is_error: !run.ok };
      }),
    });

    const clarification = clarificationFrom(runs);
    if (clarification) {
      // Record the question as an assistant message so history reads naturally on the next turn.
      newMessages.push({ role: "assistant", content: [{ type: "text", text: clarification.question }] });
      return finish("clarification", clarification.question, clarification);
    }
  }
}

function clarificationFrom(runs: ToolRun[]): Clarification | undefined {
  const run = runs.find((r) => r.ok && isToolName(r.name) && TERMINAL_TOOLS.has(r.name));
  if (!run) return undefined;
  const { question, options } = run.output as { question: string; options: string[] };
  return { question, options };
}

function errorResult(toolUseId: string, message: string): ToolResultBlockParam {
  return { type: "tool_result", tool_use_id: toolUseId, content: JSON.stringify({ error: message }), is_error: true };
}

export function textOf(message: Pick<Message, "content">): string {
  return message.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
}

function addUsage(total: Usage, u: Message["usage"]): void {
  total.inputTokens += u.input_tokens ?? 0;
  total.outputTokens += u.output_tokens ?? 0;
  total.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  total.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
}
