"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { t, type MessageKey } from "../lib/i18n";
import type { Locale } from "../lib/locale";
import { createVoiceSourceEvidence, parseVoiceSources, type VoiceSource } from "../lib/voice-sources";

type Phase = "ready" | "connecting" | "connected" | "ended" | "error";

export function VoiceConversation({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  return <ConversationProvider><VoiceSession locale={locale} onClose={onClose} /></ConversationProvider>;
}

function VoiceSession({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const copy = (key: MessageKey) => t(key, undefined, locale);
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<MessageKey | null>(null);
  const [sources, setSources] = useState<VoiceSource[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const request = useRef<AbortController | null>(null);
  const active = useRef(false);
  const attempt = useRef(0);
  const limit = useRef(60);

  const conversation = useConversation();
  const { endSession } = conversation;

  useEffect(() => {
    if (phase === "error") endSession();
  }, [phase, endSession]);

  useEffect(() => () => {
    active.current = false;
    request.current?.abort();
  }, []);

  useEffect(() => {
    if (phase !== "connecting") return;
    const timer = window.setTimeout(() => {
      active.current = false;
      request.current?.abort();
      endSession();
      setError("voice.error.connection");
      setPhase("error");
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [phase, endSession]);

  useEffect(() => {
    if (phase !== "connected") return;
    const deadline = Date.now() + limit.current * 1000;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (!remaining) {
        active.current = false;
        endSession();
        setPhase("ended");
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase, endSession]);

  async function start() {
    if (active.current || conversation.status === "connecting") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("voice.error.microphone");
      setPhase("error");
      return;
    }
    const attemptId = ++attempt.current;
    const isCurrent = () => active.current && attempt.current === attemptId;
    const sourceEvidence = createVoiceSourceEvidence();
    active.current = true;
    setError(null);
    setSources([]);
    setPhase("connecting");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!isCurrent() || controller.signal.aborted) return;
      if (!response.ok) {
        setError(response.status === 429 ? "voice.error.rateLimit"
          : response.status === 503 ? "voice.error.unavailable" : "voice.error.connection");
        active.current = false;
        setPhase("error");
        return;
      }
      const result: unknown = await response.json();
      if (!isCurrent() || controller.signal.aborted) return;
      if (!result || typeof result !== "object" || !("token" in result) || typeof result.token !== "string" || !result.token) {
        throw new Error("Invalid session");
      }
      limit.current = "maxDurationSeconds" in result && typeof result.maxDurationSeconds === "number"
        ? Math.max(1, Math.min(60, result.maxDurationSeconds)) : 60;
      conversation.startSession({
        onConnect: () => {
          if (!isCurrent()) return;
          setSecondsLeft(limit.current);
          setPhase("connected");
        },
        onDisconnect: details => {
          if (!isCurrent()) return;
          active.current = false;
          setPhase(details.reason === "error" ? "error" : "ended");
          if (details.reason === "error") setError("voice.error.connection");
        },
        onError: (_message, context) => {
          if (!isCurrent()) return;
          active.current = false;
          setPhase("error");
          const name = context instanceof Error ? context.name : "";
          setError(name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "voice.error.microphone" : "voice.error.connection");
        },
        onMessage: message => {
          if (!isCurrent()) return;
          if (message.role === "user") {
            sourceEvidence.reset();
            setSources([]);
          }
        },
        onMCPToolCall: event => {
          if (isCurrent()) sourceEvidence.record(event);
        },
        clientTools: {
          show_sources: parameters => {
            if (!isCurrent()) return 0;
            const accepted = parseVoiceSources(parameters, sourceEvidence.urls);
            setSources(accepted);
            return accepted.length;
          },
        },
        dynamicVariables: { conversation_language: locale === "pt" ? "European Portuguese (Portugal, pt-PT)" : locale === "fr" ? "French" : "English" },
        conversationToken: result.token,
        connectionType: "webrtc",
        overrides: { agent: { language: locale, firstMessage: copy("voice.greeting") } },
      });
    } catch {
      if (!isCurrent() || controller.signal.aborted) return;
      active.current = false;
      setError("voice.error.connection");
      setPhase("error");
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function stop() {
    active.current = false;
    request.current?.abort();
    endSession();
    setPhase("ended");
  }

  const connected = phase === "connected";
  const connecting = phase === "connecting";
  const statusKey: MessageKey = connecting ? "voice.connecting"
    : connected ? (conversation.isMuted ? "voice.muted" : conversation.isSpeaking ? "voice.speaking" : "voice.listening")
    : phase === "ended" ? "voice.ended" : phase === "error" ? "voice.error.title" : "voice.ready";

  return (
    <div className="voice-panel">
      <header className="voice-header">
        <h2 id="voice-title">Ask Maio</h2>
        <button type="button" className="voice-close" onClick={() => { stop(); onClose(); }} aria-label={copy("voice.close")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="voice-stage">
        <button type="button" className={`voice-orb voice-orb-trigger${connected ? " voice-orb-active" : ""}`}
          disabled={connected || connecting || conversation.status === "connecting"}
          onClick={() => { void start(); }}
          aria-label={copy(connected || connecting ? statusKey : phase === "ready" ? "voice.start" : "voice.restart")}>
          <span className="voice-orb-gradient" />
          <span className="voice-orb-grain" />
          <span className="voice-orb-phone" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 2.5c.7-.2 1.4.2 1.7.9l1.4 3.3c.3.6.1 1.3-.4 1.7l-1.6 1.3a14.2 14.2 0 0 0 6.6 6.6l1.3-1.6c.4-.5 1.1-.7 1.7-.4l3.3 1.4c.7.3 1.1 1 .9 1.7l-.6 2.7c-.2.8-.9 1.4-1.7 1.4C10 21.5 2.5 14 2.5 4.8c0-.8.6-1.5 1.4-1.7l2.7-.6Z" /></svg>
          </span>
        </button>
        <p className="voice-state" role="status">{copy(statusKey)}</p>
        <p className="voice-description">{copy("voice.description")}</p>
        {connected && <p className="voice-time" aria-label={copy("voice.remaining")}>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</p>}
      </div>
      {sources.length > 0 && <div className="voice-sources"><h3>{copy("voice.sources")}</h3><ul>
        {sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}
      </ul></div>}
      {error && <p className="voice-error" role="alert">{copy(error)}</p>}
      <div className="voice-controls">
        {connected && <button type="button" className="voice-button voice-button-secondary" aria-pressed={conversation.isMuted}
          onClick={() => conversation.setMuted(!conversation.isMuted)}>{copy(conversation.isMuted ? "voice.unmute" : "voice.mute")}</button>}
        {connected || connecting
          ? <button type="button" className="voice-button" onClick={stop}>{copy(connecting ? "voice.cancel" : "voice.end")}</button>
          : <button type="button" className="voice-button" disabled={conversation.status === "connecting"} onClick={() => { void start(); }}>{copy(phase === "ready" ? "voice.start" : "voice.restart")}</button>}
      </div>
      <p className="voice-privacy">{copy("voice.privacy")}</p>
    </div>
  );
}
