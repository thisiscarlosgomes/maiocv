import { handleFlagHealth } from "../../../../lib/chat-flags-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleFlagHealth(request);
}
