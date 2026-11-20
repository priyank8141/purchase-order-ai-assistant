export type ToolErrorCode = "invalid_input" | "permission_denied" | "not_found" | "unknown_tool" | "internal_error";

/**
 * An expected, model-facing failure. The message is sent back to Claude as an
 * `is_error` tool_result, so it must be safe to show and useful for recovery.
 */
export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function permissionDenied(what: string): ToolError {
  return new ToolError(
    "permission_denied",
    `Your role does not have access to ${what}. Tell the user politely; do not try other tools to work around this.`,
  );
}
