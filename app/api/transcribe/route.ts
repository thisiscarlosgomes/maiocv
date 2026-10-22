import { transcribe } from "ai";
import { gateway } from "@ai-sdk/gateway";

export const runtime = "nodejs";
export const maxDuration = 30;

const acceptedTypes = new Set([
  "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav", "audio/aiff",
]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0 || audio.size > 2_000_000 || !acceptedTypes.has(audio.type)) {
      return Response.json({ error: "Invalid audio" }, { status: 400 });
    }
    const result = await transcribe({
      model: gateway.transcriptionModel("openai/gpt-4o-mini-transcribe"),
      audio: new Uint8Array(await audio.arrayBuffer()),
      maxRetries: 1,
      telemetry: { isEnabled: false },
    });
    const text = result.text.trim().slice(0, 2000);
    if (!text) return Response.json({ error: "No speech detected" }, { status: 422 });
    return Response.json({ text });
  } catch {
    return Response.json({ error: "Transcription unavailable" }, { status: 502 });
  }
}
