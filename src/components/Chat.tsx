"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatResponse } from "@/agent/chat";
import { ROLE_POLICIES, ROLES, type Role } from "@/agent/roles";
import { AssistantMessage } from "./AssistantMessage";

const SUGGESTIONS = [
  "How many purchase orders are pending approval?",
  "Show overdue payments for ABC",
  "Which supplier had the most late deliveries this quarter?",
  "What's the status of PO-2026-0042?",
];

type Entry = { kind: "user"; text: string } | { kind: "assistant"; response: ChatResponse } | { kind: "error"; text: string };

export function Chat() {
  const [role, setRole] = useState<Role>("accounts");
  const [conversationId, setConversationId] = useState<string>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Block body on purpose: scrollIntoView returns a Promise in newer browsers,
  // and an effect may only return a cleanup function.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, loading]);

  // A conversation's role is fixed server-side, so switching role starts fresh.
  function switchRole(next: Role) {
    if (next === role || loading) return;
    setRole(next);
    setConversationId(undefined);
    setEntries([]);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading) return;
    setInput("");
    setEntries((e) => [...e, { kind: "user", text: message }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, role, message }),
      });
      const data: unknown = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
      const response = data as ChatResponse;
      setConversationId(response.conversationId);
      setEntries((e) => [...e, { kind: "assistant", response }]);
    } catch (err) {
      setEntries((e) => [...e, { kind: "error", text: err instanceof Error ? err.message : "Something went wrong" }]);
    } finally {
      setLoading(false);
    }
  }

  const lastAssistant = entries.findLastIndex((e) => e.kind === "assistant");

  return (
    <div className="flex min-h-[calc(100vh-57px)] flex-col py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900" role="tablist" aria-label="Role">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === role}
              onClick={() => switchRole(r)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                r === role ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {ROLE_POLICIES[r].label}
            </button>
          ))}
        </div>
        <p className="text-sm text-zinc-500">{ROLE_POLICIES[role].description}</p>
      </div>

      <div className="flex-1 space-y-4 py-6">
        {entries.length === 0 && (
          <div className="py-10 text-center">
            <h1 className="text-xl font-semibold">Ask about purchase orders</h1>
            <p className="mt-1 text-sm text-zinc-500">Plain English questions over a fake ERP. Answers come only from database lookups.</p>
          </div>
        )}
        {entries.map((e, i) =>
          e.kind === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-zinc-900 px-4 py-2.5 text-[15px] text-white dark:bg-zinc-100 dark:text-zinc-900">{e.text}</div>
            </div>
          ) : e.kind === "assistant" ? (
            <div key={i} className="flex">
              <AssistantMessage response={e.response} isLatest={i === lastAssistant && !loading} onOption={send} />
            </div>
          ) : (
            <div key={i} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {e.text}
            </div>
          ),
        )}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-zinc-500" aria-live="polite">
            <span className="flex gap-1">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
            Looking it up…
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="sticky bottom-0 space-y-3 bg-zinc-50 pb-2 pt-2 dark:bg-zinc-950">
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={loading}
              onClick={() => send(s)}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about orders, suppliers, deliveries or payments…"
            maxLength={2000}
            className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-[15px] outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
