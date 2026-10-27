import { createVoiceSessionHandler } from "../../../../lib/voice-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const handleVoiceSession = createVoiceSessionHandler();

export async function POST(request: Request) {
  return handleVoiceSession(request);
}
