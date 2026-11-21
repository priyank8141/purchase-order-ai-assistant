import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { ChatError, handleChat } from "../src/agent/chat";
import { isRole, ROLES, type Role } from "../src/agent/roles";
import { closePools } from "../src/db/client";

/**
 * Terminal chat for trying the agent before the UI exists.
 *   npm run chat -- accounts
 * Type a question; "/new" starts a new conversation, "/quit" exits.
 */
async function main(): Promise<void> {
  const arg = process.argv[2] ?? "accounts";
  if (!isRole(arg)) throw new Error(`Role must be one of: ${ROLES.join(", ")}`);
  const role: Role = arg;
  let conversationId: string | undefined;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`Purchase order assistant (role: ${role}). /new = new conversation, /quit = exit.\n`);

  for (;;) {
    const message = (await rl.question("you> ")).trim();
    if (!message) continue;
    if (message === "/quit") break;
    if (message === "/new") {
      conversationId = undefined;
      console.log("(new conversation)\n");
      continue;
    }
    try {
      const r = await handleChat({ conversationId, role, message });
      conversationId = r.conversationId;
      console.log(`\nassistant> ${r.answer}`);
      if (r.clarification?.options.length) console.log(`  options: ${r.clarification.options.join(" | ")}`);
      for (const t of r.toolCalls) console.log(`  · ${t.name} ${JSON.stringify(t.input)} -> ${t.summary}`);
      console.log(`  [${r.outcome}, trace #${r.traceId}]\n`);
    } catch (err) {
      // Short message only; full details are in the trace's error column.
      console.error(`error: ${err instanceof ChatError || err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  rl.close();
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePools());
