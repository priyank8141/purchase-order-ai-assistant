"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatResponse } from "@/agent/chat";

export function AssistantMessage({
  response,
  isLatest,
  onOption,
}: {
  response: ChatResponse;
  isLatest: boolean;
  onOption: (option: string) => void;
}) {
  const options = response.clarification?.options ?? [];
  return (
    <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="answer text-[15px] leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{response.answer}</ReactMarkdown>
      </div>

      {options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              disabled={!isLatest}
              onClick={() => onOption(o)}
              className="rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 text-sm text-indigo-800 hover:bg-indigo-100 disabled:cursor-default disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
            >
              {o}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <ValidationBadge validation={response.validation} />
        {response.outcome === "clarification" && <Pill tone="indigo">Asked to clarify</Pill>}
      </div>

      {response.toolCalls.length > 0 && <HowIGotThis toolCalls={response.toolCalls} />}
    </div>
  );
}

function ValidationBadge({ validation }: { validation: ChatResponse["validation"] }) {
  if (validation.status === "verified") {
    return (
      <Pill tone="green" title={validation.retried ? "Numbers were corrected on a second attempt" : undefined}>
        ✓ Verified{validation.retried ? " (after retry)" : ""}
      </Pill>
    );
  }
  if (validation.status === "unverified") {
    return (
      <Pill tone="amber" title={`Not found in tool results: ${validation.unsupported.join(", ")}`}>
        ⚠ Unverified numbers
      </Pill>
    );
  }
  return null;
}

function HowIGotThis({ toolCalls }: { toolCalls: ChatResponse["toolCalls"] }) {
  return (
    <details className="group mt-3 rounded-lg border border-zinc-200 bg-zinc-50 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="cursor-pointer select-none px-3 py-2 text-zinc-600 dark:text-zinc-400">
        How I got this · {toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"}
      </summary>
      <ol className="space-y-2 px-3 pb-3">
        {toolCalls.map((t, i) => (
          <li key={i} className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-2">
              <code className="font-medium">{t.name}</code>
              <span className="text-xs text-zinc-500">
                {t.ok ? "" : "failed · "}
                {t.duration_ms} ms
              </span>
            </div>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs text-zinc-600 dark:text-zinc-400">
              {JSON.stringify(t.input)}
            </pre>
            <div
              className={`mt-1 text-xs ${t.ok ? "text-zinc-700 dark:text-zinc-300" : "text-red-600 dark:text-red-400"}`}
            >
              → {t.summary}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

const TONES = {
  green:
    "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  amber: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  indigo:
    "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800",
} as const;

function Pill({ tone, title, children }: { tone: keyof typeof TONES; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={`rounded-full border px-2 py-0.5 font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
