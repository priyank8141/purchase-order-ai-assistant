import { continueTurn, runAgentTurn, type MessageParam, type TurnDeps, type TurnResult, type Usage } from "./loop";
import { collectSupportedNumbers, retryInstruction, UNVERIFIED_WARNING, validateAnswer, type ValidationResult } from "./validate";

export interface VerifiedTurn extends TurnResult {
  validation: ValidationResult & { retried: boolean };
  /** Messages to persist: the turn without the rejected answer or the retry nudge. */
  messagesToSave: MessageParam[];
}

/**
 * Runs a turn, checks the numbers in the answer, and retries once if any are
 * unsupported. If the retry still fails, the answer is returned with a visible
 * warning. Only "answered" turns are validated; clarifications, refusals and
 * tool-limit messages contain no data claims.
 */
export async function runVerifiedTurn(history: MessageParam[], question: string, deps: TurnDeps): Promise<VerifiedTurn> {
  const first = await runAgentTurn({ history, question }, deps);
  if (first.outcome !== "answered") {
    return { ...first, validation: { status: "not_applicable", unsupported: [], checked: 0, retried: false }, messagesToSave: first.newMessages };
  }

  const check = (turn: TurnResult, runs = turn.toolRuns) => validateAnswer(turn.answer, collectSupportedNumbers(runs, question, history));
  const firstCheck = check(first);
  if (firstCheck.status !== "unverified") {
    return { ...first, validation: { ...firstCheck, retried: false }, messagesToSave: first.newMessages };
  }

  // Retry: same turn, plus a correction. Claude sees its rejected answer and why.
  const nudge: MessageParam = { role: "user", content: retryInstruction(firstCheck.unsupported) };
  const retryInput = [...first.newMessages, nudge];
  const retry = await continueTurn(history, retryInput, deps);

  const allRuns = [...first.toolRuns, ...retry.toolRuns];
  const retryNew = retry.newMessages.slice(retryInput.length);
  // Drop the rejected answer (last message of the first attempt) and the nudge.
  // What remains is still valid: ...user(tool_result or question) -> assistant(...).
  const messagesToSave = [...first.newMessages.slice(0, -1), ...retryNew];
  const usage = sumUsage(first.usage, retry.usage);
  const base = { ...retry, toolRuns: allRuns, usage, modelCalls: first.modelCalls + retry.modelCalls, messagesToSave };

  if (retry.outcome !== "answered") {
    return { ...base, validation: { status: "not_applicable", unsupported: [], checked: 0, retried: true } };
  }
  const retryCheck = check(retry, allRuns);
  const answer = retryCheck.status === "unverified" ? `${retry.answer}\n\n${UNVERIFIED_WARNING}` : retry.answer;
  return { ...base, answer, validation: { ...retryCheck, retried: true } };
}

function sumUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}
