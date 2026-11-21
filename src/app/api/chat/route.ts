import { NextResponse } from "next/server";
import { z } from "zod";
import { ChatError, handleChat } from "@/agent/chat";
import { ROLES } from "@/agent/roles";

// Uses pg and the Anthropic SDK: Node runtime, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  conversationId: z.string().uuid().optional(),
  // Only used to create a new conversation; afterwards the stored role wins.
  role: z.enum(ROLES),
  message: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await handleChat(parsed.data));
  } catch (err) {
    if (err instanceof ChatError) return NextResponse.json({ error: err.message }, { status: err.status });
    // Details are in the server log and the trace row; the client gets a safe message.
    console.error("[api/chat]", err);
    return NextResponse.json({ error: "The assistant failed to answer. Please try again." }, { status: 500 });
  }
}
