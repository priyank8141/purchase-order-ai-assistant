import { z } from "zod";
import { defineTool } from "./defineTool";

/**
 * A "terminal" tool: when Claude calls it, the agent loop stops and shows the
 * question (and options as clickable chips) to the user instead of answering.
 * Making clarification an explicit tool call lets the UI render choices and
 * lets evals check "did it ask?" deterministically instead of parsing prose.
 */
export const askClarification = defineTool({
  name: "ask_clarification",
  description:
    "Ask the user a short clarifying question instead of answering. Use when: search_suppliers returned ambiguous: true " +
    "(list the candidate supplier names as options); or the question is genuinely unclear (e.g. 'pending' could mean " +
    "pending approval, pending delivery or pending payment). Do not use it when a reasonable reading is obvious, " +
    "and never combine it with a guessed answer.",
  input: z.object({
    question: z.string().trim().min(3).max(300).describe("One short question for the user."),
    options: z
      .array(z.string().trim().min(1).max(80))
      .max(6)
      .default([])
      .describe("Short answer choices the user can click, e.g. supplier names."),
  }),
  async run({ question, options }) {
    return { asked: true, question, options };
  },
});
