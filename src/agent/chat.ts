import { toolContextFor } from "../tools/index";
import { anthropicClient, claudeSettings, type ClaudeClient } from "./claude";
import { runAgentTurn, type Clarification, type TurnOutcome } from "./loop";
import { createConversation, getConversation, loadHistory, saveMessages } from "./memory";
import type { Role } from "./roles";
import { recordTrace, toToolCallTraces, type ToolCallTrace } from "./trace";

export interface ChatRequest {
  /** Omit to start a new conversation. */
  conversationId?: string;
  /** Only used when starting a new conversation. Ignored afterwards. */
  role: Role;
  message: string;
}

export interface ChatResponse {
  conversationId: string;
  role: Role;
  outcome: TurnOutcome;
  answer: string;
  clarification?: Clarification;
  toolCalls: ToolCallTrace[];
  validationPassed: boolean | null;
  traceId: number;
}

export class ChatError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Entry point for one chat message: resolve the conversation (and its fixed
 * role), load memory, run the agent, persist the turn, and record a trace.
 */
export async function handleChat(req: ChatRequest, client: ClaudeClient = anthropicClient()): Promise<ChatResponse> {
  const started = Date.now();
  const message = req.message.trim();
  if (!message) throw new ChatError(400, "Message is empty");
  if (message.length > 2000) throw new ChatError(400, "Message is too long (max 2000 characters)");

  // The role comes from the stored conversation, never from the request, once a conversation exists.
  const conversation = req.conversationId ? await getConversation(req.conversationId) : await createConversation(req.role);
  if (!conversation) throw new ChatError(404, "Conversation not found");

  const history = await loadHistory(conversation.id);
  const deps = { client, settings: claudeSettings(), ctx: toolContextFor(conversation.role) };

  try {
    const turn = await runAgentTurn({ history, question: message }, deps);
    await saveMessages(conversation.id, turn.newMessages);
    const toolCalls = toToolCallTraces(turn.toolRuns);
    // Validation is added in Phase 5; null means "not checked".
    const validationPassed = null;
    const traceId = await recordTrace({
      conversationId: conversation.id,
      question: message,
      toolCalls,
      answer: turn.answer,
      usage: turn.usage,
      latencyMs: Date.now() - started,
      validationPassed,
    });
    return {
      conversationId: conversation.id,
      role: conversation.role,
      outcome: turn.outcome,
      answer: turn.answer,
      clarification: turn.clarification,
      toolCalls,
      validationPassed,
      traceId,
    };
  } catch (err) {
    // Nothing from a failed turn is saved to memory, so the conversation stays valid.
    await recordTrace({
      conversationId: conversation.id,
      question: message,
      toolCalls: [],
      answer: null,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: Date.now() - started,
      validationPassed: null,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
