import { desc, eq } from "drizzle-orm";
import type { ToolCallTrace } from "@/agent/trace";
import { appDb } from "@/db/client";
import { conversations, traces } from "@/db/schema";

// Reads live data from Postgres on every request.
export const dynamic = "force-dynamic";

interface ValidationInfo {
  retried?: boolean;
  unsupported?: string[];
}

export default async function LogsPage() {
  const rows = await appDb()
    .select({
      id: traces.id,
      createdAt: traces.createdAt,
      role: conversations.role,
      question: traces.userQuestion,
      tools: traces.toolsCalled,
      latencyMs: traces.latencyMs,
      inputTokens: traces.inputTokens,
      outputTokens: traces.outputTokens,
      passed: traces.validationPassed,
      validation: traces.validation,
      error: traces.error,
    })
    .from(traces)
    .innerJoin(conversations, eq(conversations.id, traces.conversationId))
    .orderBy(desc(traces.id))
    .limit(100);

  return (
    <div className="py-6">
      <h1 className="text-xl font-semibold">Recent traces</h1>
      <p className="mt-1 text-sm text-zinc-500">The last 100 questions: tools called, latency, tokens, and number validation.</p>

      {rows.length === 0 ? (
        <p className="mt-8 text-center text-sm text-zinc-500">No traces yet. Ask something in the chat.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Question</th>
                <th className="px-3 py-2">Tools</th>
                <th className="px-3 py-2 text-right">Latency</th>
                <th className="px-3 py-2 text-right">Tokens in / out</th>
                <th className="px-3 py-2">Validation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((r) => {
                const tools = (r.tools as ToolCallTrace[]) ?? [];
                const v = (r.validation as ValidationInfo | null) ?? {};
                return (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{r.createdAt.toISOString().slice(5, 19).replace("T", " ")}</td>
                    <td className="px-3 py-2">{r.role}</td>
                    <td className="max-w-xs px-3 py-2">
                      {r.question}
                      {r.error && <div className="mt-1 text-xs text-red-600 dark:text-red-400">Error: {r.error}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {tools.length === 0 ? (
                        <span className="text-zinc-400">none</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {tools.map((t, i) => (
                            <li key={i} title={`${JSON.stringify(t.input)}\n→ ${t.summary}`}>
                              <code className={`text-xs ${t.ok ? "" : "text-red-600 dark:text-red-400"}`}>{t.name}</code>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{(r.latencyMs / 1000).toFixed(1)} s</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {r.passed === true && <span className="text-emerald-700 dark:text-emerald-400">✓ verified{v.retried ? " (retry)" : ""}</span>}
                      {r.passed === false && (
                        <span className="text-amber-700 dark:text-amber-400" title={v.unsupported?.join(", ")}>
                          ⚠ unverified
                        </span>
                      )}
                      {r.passed === null && <span className="text-zinc-400">n/a</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
