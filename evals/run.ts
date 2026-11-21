import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { handleChat, type ChatResponse } from "../src/agent/chat";
import { ROLES } from "../src/agent/roles";
import { demoToday } from "../src/config";
import { appDb, appPool, closePools } from "../src/db/client";
import { traces } from "../src/db/schema";
import { checkAnswerContains, checkClarifiesWith, checkNoAmounts, checkTools, type CheckResult } from "./checks";
import { judgeIsRoleRefusal } from "./judge";

/**
 * Runs every eval question through the real agent (same path as the UI) and
 * scores it. Expected answers come from SQL at run time, never hardcoded.
 *
 *   npm run eval                       all questions
 *   npm run eval -- --dry-run          compute expected values only (no API calls)
 *   npm run eval -- --only id1,id2     a subset
 *   npm run eval -- --model claude-sonnet-5-5 --effort low
 */

const Question = z.object({
  id: z.string(),
  type: z.enum(["count", "list", "ambiguity", "permission", "followup", "unclear"]),
  role: z.enum(ROLES),
  question: z.string(),
  followup: z.string().optional(),
  expected_tools: z.array(z.string()),
  expected: z.object({ sql: z.string() }).optional(),
});
type Question = z.infer<typeof Question>;

interface Result {
  id: string;
  type: Question["type"];
  role: string;
  passed: boolean;
  checks: Record<string, CheckResult>;
  expected: string[];
  toolsCalled: string[];
  outcome: string;
  answer: string;
  validation: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    dryRun: argv.includes("--dry-run"),
    only: get("--only")
      ?.split(",")
      .map((s) => s.trim()),
    model: get("--model"),
    effort: get("--effort"),
  };
}

/** Expected values: one per row, from column `value`. `$1` is today's demo date. */
async function expectedValues(q: Question): Promise<string[]> {
  if (!q.expected) return [];
  const params = q.expected.sql.includes("$1") ? [demoToday()] : [];
  const { rows } = await appPool().query<{ value: unknown }>(q.expected.sql, params);
  return rows.map((r) => String(r.value));
}

async function ask(q: Question): Promise<ChatResponse> {
  const first = await handleChat({ role: q.role, message: q.question });
  if (!q.followup) return first;
  return handleChat({ conversationId: first.conversationId, role: q.role, message: q.followup });
}

async function score(
  q: Question,
  r: ChatResponse,
  expected: string[],
  judgeModel: string,
): Promise<Record<string, CheckResult>> {
  const called = r.toolCalls.map((t) => t.name);
  const checks: Record<string, CheckResult> = { tools: checkTools(q.expected_tools, called) };
  const clarified: CheckResult = {
    ok: r.outcome === "clarification",
    detail: r.outcome === "clarification" ? "ok" : `outcome was ${r.outcome}`,
  };

  switch (q.type) {
    case "count":
    case "list":
    case "followup":
      checks.answered = { ok: r.outcome === "answered", detail: r.outcome };
      checks.answer = checkAnswerContains(r.answer, expected);
      break;
    case "ambiguity":
      checks.clarified = clarified;
      checks.candidates = checkClarifiesWith(r.clarification?.options ?? [], r.answer, expected);
      break;
    case "unclear":
      checks.clarified = clarified;
      break;
    case "permission": {
      checks.no_amounts = checkNoAmounts(r.answer);
      const refused = await judgeIsRoleRefusal(q.question, r.answer, judgeModel);
      checks.refused = { ok: refused, detail: refused ? "ok" : "judge: not a role refusal" };
      break;
    }
  }
  return checks;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // The agent reads these from env on every call, so overriding here is enough.
  if (args.model) process.env.ANTHROPIC_MODEL = args.model;
  if (args.effort) process.env.ANTHROPIC_EFFORT = args.effort;
  const judgeModel = process.env.EVAL_JUDGE_MODEL ?? "claude-haiku-5-5";

  const all = z.array(Question).parse(JSON.parse(readFileSync(new URL("./questions.json", import.meta.url), "utf8")));
  const questions = args.only ? all.filter((q) => args.only!.includes(q.id)) : all;

  if (args.dryRun) {
    console.log(`Dry run: ${questions.length} questions, expected values from SQL (no API calls)\n`);
    for (const q of questions) {
      const exp = await expectedValues(q);
      console.log(`${q.id.padEnd(32)} ${q.type.padEnd(10)} ${q.role.padEnd(9)} ${exp.length ? exp.join(", ") : "-"}`);
    }
    return;
  }

  console.log(
    `Running ${questions.length} evals · model=${process.env.ANTHROPIC_MODEL} effort=${process.env.ANTHROPIC_EFFORT ?? "medium"} judge=${judgeModel}\n`,
  );
  const results: Result[] = [];
  for (const q of questions) {
    const expected = await expectedValues(q);
    const started = Date.now();
    try {
      const r = await ask(q);
      const checks = await score(q, r, expected, judgeModel);
      const [trace] = await appDb().select().from(traces).where(eq(traces.id, r.traceId));
      results.push({
        id: q.id,
        type: q.type,
        role: q.role,
        passed: Object.values(checks).every((c) => c.ok),
        checks,
        expected,
        toolsCalled: r.toolCalls.map((t) => t.name),
        outcome: r.outcome,
        answer: r.answer,
        validation: r.validation.status,
        latencyMs: Date.now() - started,
        inputTokens: trace?.inputTokens ?? 0,
        outputTokens: trace?.outputTokens ?? 0,
      });
    } catch (err) {
      results.push({
        id: q.id,
        type: q.type,
        role: q.role,
        passed: false,
        checks: {},
        expected,
        toolsCalled: [],
        outcome: "error",
        answer: "",
        validation: "-",
        latencyMs: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const last = results.at(-1)!;
    const failed = Object.entries(last.checks)
      .filter(([, c]) => !c.ok)
      .map(([k, c]) => `${k}: ${c.detail}`);
    const why = last.error ? `error: ${last.error}` : failed.join("; ");
    console.log(
      `${last.passed ? "PASS" : "FAIL"}  ${last.id.padEnd(32)} ${last.type.padEnd(10)} ${(last.latencyMs / 1000).toFixed(1)}s  ${why}`,
    );
  }

  const passed = results.filter((r) => r.passed).length;
  const tokensIn = results.reduce((s, r) => s + r.inputTokens, 0);
  const tokensOut = results.reduce((s, r) => s + r.outputTokens, 0);
  console.log(
    `\n${passed}/${results.length} passed · ${tokensIn.toLocaleString()} input / ${tokensOut.toLocaleString()} output tokens (excl. judge)`,
  );

  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  const file = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
  writeFileSync(
    file,
    JSON.stringify(
      {
        model: process.env.ANTHROPIC_MODEL,
        effort: process.env.ANTHROPIC_EFFORT,
        score: `${passed}/${results.length}`,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`Saved ${file.pathname}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePools());
