import type Anthropic from "@anthropic-ai/sdk";
import { policyFor, type Role } from "../agent/roles";
import { demoCurrency, demoToday } from "../config";
import { readonlyPool } from "../db/client";
import { askClarification } from "./askClarification";
import { countPurchaseOrders } from "./countPurchaseOrders";
import type { RegisteredTool, ToolContext, ToolOutput } from "./defineTool";
import { ToolError, type ToolErrorCode } from "./errors";
import { getDeliverySummary } from "./getDeliverySummary";
import { getPaymentDues } from "./getPaymentDues";
import { getPurchaseOrderDetails } from "./getPurchaseOrderDetails";
import { getSupplierSummary } from "./getSupplierSummary";
import { listPurchaseOrders } from "./listPurchaseOrders";
import { isToolName, TOOL_NAMES, type ToolName } from "./names";
import { searchSuppliers } from "./searchSuppliers";

const REGISTRY: Record<ToolName, RegisteredTool> = {
  search_suppliers: searchSuppliers,
  count_purchase_orders: countPurchaseOrders,
  list_purchase_orders: listPurchaseOrders,
  get_purchase_order_details: getPurchaseOrderDetails,
  get_supplier_summary: getSupplierSummary,
  get_payment_dues: getPaymentDues,
  get_delivery_summary: getDeliverySummary,
  ask_clarification: askClarification,
};

/** Tools whose call ends the turn: the loop shows their output to the user instead of calling Claude again. */
export const TERMINAL_TOOLS: ReadonlySet<ToolName> = new Set(["ask_clarification"]);

/**
 * Layer 1 of permissions: Claude only ever sees the tools its role may use.
 * Order is fixed (TOOL_NAMES order) so the tool list is byte-identical per role,
 * which keeps the prompt cache warm. The cache breakpoint goes on the last tool.
 */
export function toolDefinitionsForRole(role: Role): Anthropic.Beta.BetaTool[] {
  const allowed = policyFor(role).tools;
  const defs: Anthropic.Beta.BetaTool[] = TOOL_NAMES.filter((n) => allowed.includes(n)).map((n) => ({
    name: n,
    description: REGISTRY[n].description,
    input_schema: REGISTRY[n].inputSchema,
  }));
  const last = defs.at(-1);
  if (last) last.cache_control = { type: "ephemeral" };
  return defs;
}

export function toolContextFor(role: Role): ToolContext {
  return { role, today: demoToday(), currency: demoCurrency(), db: readonlyPool() };
}

export interface ToolRun {
  name: string;
  input: unknown;
  ok: boolean;
  output: ToolOutput;
  errorCode?: ToolErrorCode;
  durationMs: number;
}

/** Runs a tool call from Claude. Never throws: failures become `ok: false` results that Claude can recover from. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolRun> {
  const started = Date.now();
  const done = (ok: boolean, output: ToolOutput, errorCode?: ToolErrorCode): ToolRun => ({
    name,
    input,
    ok,
    output,
    errorCode,
    durationMs: Date.now() - started,
  });

  if (!isToolName(name))
    return done(false, { error: "unknown_tool", message: `There is no tool named ${name}.` }, "unknown_tool");
  try {
    return done(true, await REGISTRY[name].execute(input, ctx));
  } catch (err) {
    if (err instanceof ToolError) return done(false, { error: err.code, message: err.message }, err.code);
    // Unexpected errors (DB down, SQL bug): log details server-side, give Claude a safe message.
    console.error(`[tool ${name}] unexpected error`, err);
    return done(
      false,
      { error: "internal_error", message: "The tool failed unexpectedly. Try again or tell the user." },
      "internal_error",
    );
  }
}
