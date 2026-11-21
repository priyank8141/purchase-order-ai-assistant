import type Anthropic from "@anthropic-ai/sdk";
import type { ClaudeClient, Message, MessageParams } from "@/agent/claude";

type Block = Anthropic.Beta.BetaContentBlock;

export const text = (t: string): Block => ({ type: "text", text: t, citations: null }) as Block;
export const thinking = (t: string): Block => ({ type: "thinking", thinking: t, signature: "sig" }) as Block;
let idCounter = 0;
export const toolUse = (name: string, input: unknown): Block =>
  ({ type: "tool_use", id: `toolu_${++idCounter}`, name, input, caller: { type: "direct" } }) as Block;

export function reply(stop: Message["stop_reason"], ...content: Block[]): Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "fake",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
  } as unknown as Message;
}

/** A Claude client that returns scripted responses in order and records every request. */
export class FakeClaude implements ClaudeClient {
  readonly requests: MessageParams[] = [];
  constructor(private readonly script: Message[]) {}

  async createMessage(params: MessageParams): Promise<Message> {
    // Deep copy: the loop keeps mutating its arrays after the call.
    this.requests.push(structuredClone(params));
    const next = this.script.shift();
    if (!next) throw new Error("FakeClaude: script exhausted");
    return next;
  }
}
