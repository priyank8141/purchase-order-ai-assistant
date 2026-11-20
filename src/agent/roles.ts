import { TOOL_NAMES, type ToolName } from "../tools/names";

export const ROLES = ["warehouse", "accounts", "admin"] as const;
export type Role = (typeof ROLES)[number];

export interface RolePolicy {
  label: string;
  description: string;
  /** Layer 1: only these tools are ever sent to Claude for this role. */
  tools: readonly ToolName[];
  /** Layer 2: tools strip money fields from their output when false. */
  canSeeAmounts: boolean;
  /** Layer 2: tools refuse payment filters and omit payment data when false. */
  canSeePayments: boolean;
}

const WAREHOUSE_TOOLS: readonly ToolName[] = TOOL_NAMES.filter((t) => t !== "get_payment_dues");

export const ROLE_POLICIES: Record<Role, RolePolicy> = {
  warehouse: {
    label: "Warehouse",
    description: "Orders and deliveries. No amounts, prices or payment data.",
    tools: WAREHOUSE_TOOLS,
    canSeeAmounts: false,
    canSeePayments: false,
  },
  accounts: {
    label: "Accounts",
    description: "Everything, including amounts and payments.",
    tools: TOOL_NAMES,
    canSeeAmounts: true,
    canSeePayments: true,
  },
  // Same data access as accounts today; kept separate so admin-only features
  // (e.g. write tools with approval) have a home later.
  admin: {
    label: "Admin",
    description: "Everything.",
    tools: TOOL_NAMES,
    canSeeAmounts: true,
    canSeePayments: true,
  },
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function policyFor(role: Role): RolePolicy {
  return ROLE_POLICIES[role];
}

export function canUseTool(role: Role, tool: ToolName): boolean {
  return ROLE_POLICIES[role].tools.includes(tool);
}
