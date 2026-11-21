import type Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "pg";
import { z } from "zod";
import { canUseTool, type Role } from "../agent/roles";
import { permissionDenied, ToolError } from "./errors";
import type { ToolName } from "./names";
import { redactForRole } from "./redact";

export interface ToolContext {
  role: Role;
  /** Pinned demo date (YYYY-MM-DD); "overdue" etc. are relative to this. */
  today: string;
  currency: string;
  /** Must be the read-only pool in the app. Tests may pass the same. */
  db: Pick<Pool, "query">;
}

export type ToolOutput = Record<string, unknown>;

interface ToolSpec<S extends z.ZodObject> {
  name: ToolName;
  description: string;
  input: S;
  run(input: z.output<S>, ctx: ToolContext): Promise<ToolOutput>;
}

export interface RegisteredTool {
  name: ToolName;
  description: string;
  inputSchema: Anthropic.Beta.BetaTool.InputSchema;
  /** Validates input, enforces role, runs, and redacts. Throws ToolError on expected failures. */
  execute(rawInput: unknown, ctx: ToolContext): Promise<ToolOutput>;
}

export function defineTool<S extends z.ZodObject>(spec: ToolSpec<S>): RegisteredTool {
  // One Zod schema drives both validation and the JSON schema Claude sees.
  // io: "input" keeps defaulted fields optional in the published schema.
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(spec.input, { io: "input" });

  return {
    name: spec.name,
    description: spec.description,
    inputSchema: jsonSchema as Anthropic.Beta.BetaTool.InputSchema,
    async execute(rawInput, ctx) {
      // Defense in depth: even if a disallowed tool somehow gets called
      // (prompt injection, a bug in the tool list), it refuses here.
      if (!canUseTool(ctx.role, spec.name)) throw permissionDenied(`the ${spec.name} tool`);

      const parsed = spec.input.safeParse(rawInput ?? {});
      if (!parsed.success) {
        throw new ToolError("invalid_input", `Invalid input for ${spec.name}: ${z.prettifyError(parsed.error)}`);
      }
      const output = await spec.run(parsed.data, ctx);
      return redactForRole(output, ctx.role);
    },
  };
}
