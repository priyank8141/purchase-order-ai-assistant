/** Tool names live in their own module so roles.ts and the tool registry can both import them without a cycle. */
export const TOOL_NAMES = [
  "search_suppliers",
  "count_purchase_orders",
  "list_purchase_orders",
  "get_purchase_order_details",
  "get_supplier_summary",
  "get_payment_dues",
  "get_delivery_summary",
  "ask_clarification",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}
