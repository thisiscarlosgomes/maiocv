import { handleFlagGet, handleFlagPost } from "../../../lib/chat-flags-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleFlagGet(request);
}

export function POST(request: Request) {
  return handleFlagPost(request);
}
