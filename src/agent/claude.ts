import Anthropic from "@anthropic-ai/sdk";

/**
 * The single place that talks to the Claude API. The agent loop depends on the
 * `ClaudeClient` interface, so tests can swap in a scripted fake.
 */

export type MessageParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
export type Message = Anthropic.Beta.BetaMessage;

export interface ClaudeClient {
  createMessage(params: MessageParams): Promise<Message>;
}

type Effort = NonNullable<NonNullable<MessageParams["output_config"]>["effort"]>;
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface ClaudeSettings {
  model: string;
  effort: Effort;
  refusalFallback: boolean;
}

/** Model comes from env on purpose: the demo never hardcodes a model name. */
export function claudeSettings(): ClaudeSettings {
  const model = process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("Missing ANTHROPIC_MODEL (see .env.example)");
  const effort = (process.env.ANTHROPIC_EFFORT ?? "medium") as Effort;
  if (!EFFORTS.includes(effort)) throw new Error(`ANTHROPIC_EFFORT must be one of ${EFFORTS.join(", ")}`);
  return { model, effort, refusalFallback: (process.env.ANTHROPIC_REFUSAL_FALLBACK ?? "default") !== "off" };
}

/** Request fields shared by every call: model, effort, and the optional server-side refusal fallback. */
export function baseRequest(settings: ClaudeSettings): Pick<MessageParams, "model" | "output_config" | "betas" | "fallbacks"> {
  return {
    model: settings.model,
    output_config: { effort: settings.effort },
    ...(settings.refusalFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
  };
}

let shared: Anthropic | undefined;

export function anthropicClient(): ClaudeClient {
  // The SDK reads ANTHROPIC_API_KEY (or other configured credentials) itself.
  shared ??= new Anthropic();
  const client = shared;
  return { createMessage: (params) => client.beta.messages.create(params) };
}
