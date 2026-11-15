import { after } from "next/server";
import { handleMaioChat } from "../../../lib/maio-chat-proxy";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleMaioChat(request, { after: (task) => { after(() => task()); } });
}
