"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import { BUSINESS_DATA_URL, businessMetricProgram } from "../lib/business-visual";
import { ChatMarkdown } from "./chat-markdown";
import { PLACE_COLLECTIONS, placeDataUrl, placeVisualProgram } from "../lib/place-visual";
import { publicChatResponse, publicChatGreeting } from "../lib/chat-answer";
import { isPopulationTotalQuestion, populationAnswer, POPULATION_DATA_URL } from "../lib/population-answer";
import { declaredCitations, type Citation } from "../lib/chat-citations";
import { t, type MessageKey } from "../lib/i18n";
import type { Locale } from "../lib/locale";
import { VoiceDialog, preloadVoiceConversation } from "./voice-dialog";

const OpenUIBusiness = dynamic(() => import("./openui-business").then(module => module.OpenUIBusiness));
const OpenUIPlaces = dynamic(() => import("./openui-places").then(module => module.OpenUIPlaces));


type Message = {
  role: "user" | "assistant";
  content: string;
  visual?: { kind: "business" | "places"; program: string };
  citations?: Citation[];
  uncited?: boolean;
  example?: boolean;
};

const suggestionKeys = [
  [
    ["chat.suggest.beaches", "chat.suggest.beaches.prompt"],
    ["chat.suggest.business", "chat.suggest.business.prompt"],
    ["chat.suggest.tourism", "chat.suggest.tourism.prompt"],
  ],
  [
    ["chat.suggest.beaches2", "chat.suggest.beaches2.prompt"],
    ["chat.suggest.business2", "chat.suggest.business2.prompt"],
    ["chat.suggest.tourism2", "chat.suggest.tourism2.prompt"],
  ],
  [
    ["chat.suggest.beaches3", "chat.suggest.beaches3.prompt"],
    ["chat.suggest.business3", "chat.suggest.business3.prompt"],
    ["chat.suggest.tourism3", "chat.suggest.tourism3.prompt"],
  ],
] as const;

const suggestionStorageKey = "maiocv-chat-suggestions-v1";

export function Chat({ locale = "pt" }: { locale?: Locale }) {
  const copy = (key: MessageKey, values?: Record<string, string | number>) => t(key, values, locale);
  const [suggestionVariant, setSuggestionVariant] = useState(0);
  const suggestions = suggestionKeys[suggestionVariant].map(([label, prompt]) => ({ label: copy(label), prompt: copy(prompt) }));
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savingPdf, setSavingPdf] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState<number | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const voiceLauncher = useRef<HTMLButtonElement>(null);
  const active = useRef<AbortController | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioStream = useRef<MediaStream | null>(null);
  const audioUpload = useRef<AbortController | null>(null);
  const voiceSession = useRef(0);
  const voiceTimer = useRef<number | null>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const conversationPane = useRef<HTMLDivElement>(null);
  const latestQuestion = useRef<HTMLElement>(null);
  const scrollTail = useRef<HTMLDivElement>(null);
  const scrollToQuestion = useRef<number | null>(null);
  const pendingQuestionScroll = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const suggestionsInitialized = useRef(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (suggestionsInitialized.current) return;
    suggestionsInitialized.current = true;
    // Pick a random starting set, then cycle so reopening the chat shows new ideas.
    try {
      const stored = window.sessionStorage.getItem(suggestionStorageKey);
      const next = stored === null ? Math.floor(Math.random() * suggestionKeys.length) : Number(stored);
      const variant = Number.isInteger(next) && next >= 0 && next < suggestionKeys.length ? next : 0;
      setSuggestionVariant(variant);
      window.sessionStorage.setItem(suggestionStorageKey, String((variant + 1) % suggestionKeys.length));
    } catch {
      setSuggestionVariant(Math.floor(Math.random() * suggestionKeys.length));
    }
  }, []);

  useEffect(() => {
    const screen = conversationPane.current?.closest<HTMLElement>(".chat-screen");
    const viewport = window.visualViewport;
    if (!screen || !viewport) return;
    let frame = 0;
    const syncViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // iOS keyboards resize the visual viewport. Preserve normal pinch zoom.
        if (viewport.scale !== 1) return;
        screen.style.setProperty("--chat-height", `${viewport.height}px`);
        screen.style.setProperty("--chat-offset-top", `${viewport.offsetTop}px`);
        screen.dataset.compact = viewport.height < 320 ? "tiny" : viewport.height < 440 ? "true" : "false";
      });
    };
    syncViewport();
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
      screen.style.removeProperty("--chat-height");
      screen.style.removeProperty("--chat-offset-top");
      delete screen.dataset.compact;
    };
  }, []);

  useEffect(() => {
    setCanRecord(Boolean(navigator.mediaDevices && "getUserMedia" in navigator.mediaDevices && "MediaRecorder" in window));
    return () => {
      active.current?.abort();
      voiceSession.current += 1;
      audioUpload.current?.abort();
      if (voiceTimer.current !== null) window.clearTimeout(voiceTimer.current);
      if (recorder.current) recorder.current.onstop = null;
      if (recorder.current?.state === "recording") recorder.current.stop();
      audioStream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);
  useEffect(() => {
    const pane = conversationPane.current;
    if (!pane) return;
    const observer = new ResizeObserver(() => updateQuestionSpace());
    observer.observe(pane);
    const log = pane.querySelector('[role="log"]');
    if (log) observer.observe(log);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 150)}px`;
  }, [draft]);
  useLayoutEffect(() => {
    const pane = conversationPane.current;
    if (!pane || scrollToQuestion.current === null || !latestQuestion.current) return;
    const questionTop = updateQuestionSpace();
    if (pendingQuestionScroll.current && questionTop !== null) {
      pendingQuestionScroll.current = false;
      pane.scrollTo({ top: questionTop - 12, behavior: reduced ? "instant" : "smooth" });
    }
  }, [messages, busy, error, reduced]);

  function updateQuestionSpace(): number | null {
    const pane = conversationPane.current;
    const question = latestQuestion.current;
    const tail = scrollTail.current;
    if (!pane || !tail) return null;
    tail.style.height = "0px";
    if (!question || scrollToQuestion.current === null) return null;
    const questionTop = pane.scrollTop + question.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    const spaceBelow = pane.scrollHeight - questionTop;
    tail.style.height = `${Math.max(0, pane.clientHeight + 12 - spaceBelow)}px`;
    return questionTop;
  }

  async function send(question = draft, suggestedPrompt?: string) {
    const text = question.trim();
    if (!text || active.current) return;
    const greeting = publicChatGreeting(text, locale);
    if (greeting) {
      scrollToQuestion.current = messages.length;
      pendingQuestionScroll.current = true;
      setMessages([...messages, { role: "user", content: text }, { role: "assistant", content: greeting, example: true, uncited: true }]);
      setDraft(""); setError("");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    scrollToQuestion.current = messages.length;
    pendingQuestionScroll.current = true;
    const conversation: Message[] = [...messages, { role: "user", content: text }];
    setMessages(conversation); setDraft(""); setError(""); setBusy(true);
    const timeout = window.setTimeout(() => controller.abort(), 90000);
    try {
      if (isPopulationTotalQuestion(text)) {
        const source = await fetch(POPULATION_DATA_URL, { signal: controller.signal });
        if (!source.ok) throw new Error(copy("chat.error.population"));
        const answer = populationAnswer(await source.json(), text);
        if (!answer) throw new Error(copy("chat.error.populationValue"));
        if (active.current === controller)
          setMessages([...conversation, { role: "assistant", content: answer, uncited: true }]);
        return;
      }
      const outbound = conversation.slice(-12).map(({ role, content }) => ({ role, content }));
      if (suggestedPrompt && outbound.at(-1)?.role === "user") {
        outbound[outbound.length - 1] = { role: "user", content: suggestedPrompt };
      }
      const instruction = locale === "fr"
        ? "Reply in French. Keep source titles in their original language."
        : locale === "en"
          ? "Reply in English. Keep source titles in their original language."
          : "";
      if (instruction && outbound.at(-1)?.role === "user") {
        const last = outbound[outbound.length - 1];
        outbound[outbound.length - 1] = { role: last.role, content: last.content + "\n\n" + instruction };
      }
      const response = await fetch("/api/maio-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ messages: outbound, context: { surface: "mcp-guide", lang: locale } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429 && typeof data.limit === "number" && typeof data.windowHours === "number") {
          const resetAt = typeof data.resetAt === "string" ? new Date(data.resetAt) : null;
          const reset = resetAt && !Number.isNaN(resetAt.getTime())
            ? new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : locale === "fr" ? "fr-FR" : "en-GB",
              { dateStyle: "medium", timeStyle: "short" }).format(resetAt)
            : null;
          throw new Error(reset
            ? copy("chat.error.quotaReset", { limit: data.limit, hours: data.windowHours, reset })
            : copy("demo.quota", { limit: data.limit, hours: data.windowHours }));
        }
        throw new Error(response.status === 429 ? copy("chat.error.busy") : copy("chat.error.answer"));
      }
      const publicAnswer = publicChatResponse(data, text, locale);
      if (!publicAnswer) throw new Error(copy("chat.error.empty"));
      let visual: Message["visual"];
      const pilotEnabled = new URLSearchParams(window.location.search).get("openui") === "1";
      const usedBusinessData = Array.isArray(data.toolEvents) && data.toolEvents.some(
        (event: { name?: string; arguments?: { datasetId?: string }; ok?: boolean }) =>
          event.name === "get_open_data_dataset" &&
          event.arguments?.datasetId === "business-demography" && event.ok === true,
      );
      if (pilotEnabled && usedBusinessData) {
        try {
          const source = await fetch(BUSINESS_DATA_URL, { signal: controller.signal });
          if (source.ok) {
            const program = businessMetricProgram(await source.json(), locale);
            if (program) visual = { kind: "business", program };
          }
        } catch {
        }
      }
      if (pilotEnabled && !visual && Array.isArray(data.toolEvents)) {
        const placeEvent = data.toolEvents.find((event: { name?: string; arguments?: { collectionId?: string }; ok?: boolean }) =>
          event.name === "get_open_data_collection" && event.ok === true &&
          typeof event.arguments?.collectionId === "string" && event.arguments.collectionId in PLACE_COLLECTIONS,
        );
        const collection = placeEvent?.arguments?.collectionId;
        if (collection) {
          try {
            const source = await fetch(placeDataUrl(collection), { signal: controller.signal });
            if (source.ok) {
              const program = placeVisualProgram(await source.json(), publicAnswer, collection, locale);
              if (program) visual = { kind: "places", program };
            }
          } catch {
          }
        }
      }
      if (active.current === controller) {
        const declared = declaredCitations(data);
        setMessages([...conversation, {
          role: "assistant",
          content: publicAnswer,
          visual,
          citations: declared ?? undefined,
          uncited: declared !== null && declared.length === 0,
          example: data.prepared === true,
        }]);
      }
    } catch (cause) {
      if (active.current === controller) {
        scrollToQuestion.current = null;
        pendingQuestionScroll.current = false;
        setMessages(messages);
        setDraft(text);
        setError(controller.signal.aborted
          ? copy("chat.error.timeout")
          : cause instanceof Error ? cause.message : copy("chat.error.generic"));
      }
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null; setBusy(false);
        input.current?.focus({ preventScroll: true });
      }
    }
  }

  function clearChat() {
    voiceSession.current += 1;
    audioUpload.current?.abort();
    audioUpload.current = null;
    if (voiceTimer.current !== null) window.clearTimeout(voiceTimer.current);
    if (recorder.current) recorder.current.onstop = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    audioStream.current?.getTracks().forEach(track => track.stop());
    audioStream.current = null;
    setRecording(false);
    setTranscribing(false);
    setVoiceError("");
    const controller = active.current;
    active.current = null;
    controller?.abort();
    scrollToQuestion.current = null;
    pendingQuestionScroll.current = false;
    setMessages([]);
    setDraft("");
    setError("");
    setPdfError(null);
    setSavingPdf(null);
    setBusy(false);
    const nextVariant = (suggestionVariant + 1) % suggestionKeys.length;
    setSuggestionVariant(nextVariant);
    try { window.sessionStorage.setItem(suggestionStorageKey, String((nextVariant + 1) % suggestionKeys.length)); } catch {}
    input.current?.focus({ preventScroll: true });
  }

  async function submitAudio(file: File, session: number, originalDraft: string) {
    if (file.size === 0 || file.size > 2_000_000) {
      setVoiceError(copy("chat.voice.size"));
      return;
    }
    const controller = new AbortController();
    audioUpload.current = controller;
    setTranscribing(true);
    setVoiceError("");
    try {
      const form = new FormData();
      form.append("audio", file);
      const response = await fetch("/api/transcribe", { method: "POST", body: form, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 422 ? copy("chat.voice.noSpeech") : copy("chat.voice.error"));
      const transcript = typeof data.text === "string" ? data.text.trim() : "";
      if (!transcript) throw new Error(copy("chat.voice.noSpeech"));
      if (session === voiceSession.current) {
        const question = [originalDraft, transcript].filter(Boolean).join(" ");
        setTranscribing(false);
        void send(question);
      }
    } catch (cause) {
      if (session === voiceSession.current)
        setVoiceError(cause instanceof Error ? cause.message : copy("chat.voice.error"));
    } finally {
      if (session === voiceSession.current) {
        audioUpload.current = null;
        setTranscribing(false);
      }
    }
  }

  async function toggleVoice() {
    if (recording) {
      if (recorder.current?.state === "recording") recorder.current.stop();
      return;
    }
    if (!canRecord) {
      audioInput.current?.click();
      return;
    }
    if (active.current) return;
    const session = ++voiceSession.current;
    const originalDraft = draft.trim();
    try {
      const microphone = navigator.mediaDevices.getUserMedia({ audio: true });
      let permissionTimer: number | undefined;
      const timeout = new Promise<never>((_, reject) => {
        permissionTimer = window.setTimeout(() => reject(new Error("Microphone request timed out")), 8000);
      });
      microphone.then(stream => {
        if (session !== voiceSession.current) stream.getTracks().forEach(track => track.stop());
      }).catch(() => {});
      const stream = await Promise.race([microphone, timeout]).finally(() => window.clearTimeout(permissionTimer));
      if (session !== voiceSession.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      audioStream.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"]
        .find(type => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      let failed = false;
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onerror = () => {
        failed = true;
        if (session === voiceSession.current) setVoiceError(copy("chat.voice.error"));
      };
      current.onstop = () => {
        if (voiceTimer.current !== null) window.clearTimeout(voiceTimer.current);
        stream.getTracks().forEach(track => track.stop());
        audioStream.current = null;
        recorder.current = null;
        if (session !== voiceSession.current) return;
        setRecording(false);
        if (failed || chunks.length === 0) {
          setVoiceError(copy("chat.voice.noSpeech"));
          return;
        }
        const type = current.mimeType.split(";")[0] || "audio/webm";
        const extension = type === "audio/mp4" ? "m4a" : "webm";
        const file = new File(chunks, `maio-question.${extension}`, { type });
        void submitAudio(file, session, originalDraft);
      };
      current.start(1000);
      recorder.current = current;
      voiceTimer.current = window.setTimeout(() => {
        if (current.state === "recording") current.stop();
      }, 30000);
      setRecording(true);
      setVoiceError("");
    } catch {
      voiceSession.current += 1;
      audioStream.current?.getTracks().forEach(track => track.stop());
      audioStream.current = null;
      setCanRecord(false);
      setVoiceError(copy("chat.voice.fallback"));
    }
  }

  async function downloadAnswer(index: number) {
    const answer = messages[index];
    const question = messages.slice(0, index).reverse().find(message => message.role === "user");
    if (!answer || !question || savingPdf !== null) return;
    setSavingPdf(index);
    setPdfError(null);
    try {
      const { saveChatAnswerPdf } = await import("../lib/chat-pdf");
      await saveChatAnswerPdf({
        question: question.content,
        answer: answer.content,
        citations: answer.citations,
        example: answer.example,
        uncited: answer.uncited,
        locale,
        labels: {
          question: copy("chat.pdf.question"),
          answer: copy("chat.pdf.answer"),
          sources: copy("chat.pdf.sources"),
          example: copy("chat.example"),
          noSource: copy("chat.noSource"),
        },
      });
    } catch {
      setPdfError(index);
    } finally {
      setSavingPdf(null);
    }
  }

  return (
    <main className="chat-page" id="conteudo">
      <div ref={conversationPane} className={`chat-conversation${!messages.length && !busy ? " chat-conversation-empty" : ""}`}>
        {messages.length || busy ? <h1 className="sr-only">{copy("chat.welcome")}</h1> : null}
        {!messages.length && !busy && (
          <div className="chat-welcome">
            <h1>{copy("chat.welcome")}</h1>
            <div className="chat-suggestions">
              {suggestions.map(({ label, prompt }) => (
                <button key={label} type="button" disabled={recording || transcribing} onClick={() => { void send(label, prompt); }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div role="log" aria-label={copy("chat.log")} aria-live="polite" aria-relevant="additions">
          {messages.map((message, index) => (
            <motion.article key={index} ref={message.role === "user" && index === scrollToQuestion.current ? latestQuestion : null}
              className={`chat-message chat-message-${message.role}`}
              initial={reduced ? false : message.role === "user" ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              {message.visual?.kind === "business" && <OpenUIBusiness program={message.visual.program} />}
              {message.visual?.kind === "places" && <OpenUIPlaces program={message.visual.program} locale={locale} />}
              {!message.visual && (message.role === "assistant"
                ? <ChatMarkdown content={message.content}
                    onFollowUp={index === messages.length - 1 ? question => { void send(question); } : undefined}
                    disabled={busy || recording || transcribing} />
                : <p>{message.content}</p>)}
              {message.example ? <p className="chat-example">{copy("chat.example")}</p> : null}
              {message.uncited ? <p className="chat-no-source">{copy("chat.noSource")}</p> : null}
              {message.citations?.map((citation) => (
                <p key={citation.name}>
                  {citation.href ? <a className="chat-citation" href={citation.href}>{citation.name}</a> : citation.name}
                  {citation.kind ? ` · ${citation.kind}` : ""}
                </p>
              ))}
              {message.role === "assistant" && (
                <div className="chat-answer-actions">
                  <button type="button" className="chat-pdf-button" onClick={() => { void downloadAnswer(index); }}
                    disabled={savingPdf !== null} aria-label={copy("chat.savePdf")} title={copy("chat.savePdf")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3v12m-4-4 4 4 4-4M5 17v3h14v-3" />
                    </svg>
                    <span>{savingPdf === index ? copy("chat.savingPdf") : "PDF"}</span>
                  </button>
                  {pdfError === index && <span role="alert" className="chat-pdf-error">{copy("chat.pdfError")}</span>}
                </div>
              )}
            </motion.article>
          ))}
        </div>
        {busy && <div role="status" className="chat-status chat-thinking">
          <span className="thinking-dots" aria-hidden="true"><span /><span /><span /></span>
          <span className="thinking-label">{copy("chat.thinking")}</span>
        </div>}
        {error && <p role="alert" className="chat-error">{error}</p>}
        <div ref={scrollTail} aria-hidden="true" />
      </div>
      <div className="chat-composer-wrap">
        <div className="chat-voice-launcher-wrap">
          <button ref={voiceLauncher} type="button" className="chat-voice-launcher" disabled={busy || recording || transcribing}
            onPointerEnter={preloadVoiceConversation} onFocus={preloadVoiceConversation} onPointerDown={preloadVoiceConversation}
            onClick={() => setVoiceOpen(true)} aria-haspopup="dialog">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4" />
            </svg>
            {copy("voice.launch")}
          </button>
        </div>
        {recording && <p role="status" className="chat-voice-status">{copy("chat.voice.listening")}</p>}
        {transcribing && <p role="status" className="chat-voice-status">{copy("chat.voice.transcribing")}</p>}
        <form className="chat-composer" onSubmit={event => { event.preventDefault(); if (!recording && !transcribing) void send(); }}>
          <input ref={audioInput} hidden type="file" accept="audio/*" capture="user" tabIndex={-1}
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void submitAudio(file, ++voiceSession.current, draft.trim());
            }} />
          <label className="sr-only" htmlFor="chat-question">{copy("chat.label")}</label>
          <textarea id="chat-question" ref={input} value={draft} maxLength={2000} enterKeyHint="send"
            placeholder={copy("chat.placeholder")} rows={1} readOnly={busy || recording || transcribing}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault(); if (!recording && !transcribing) void send();
              }
            }} />
          <button type="button" className="chat-clear" onClick={clearChat}
            disabled={!messages.length && !draft && !busy && !error && !recording && !transcribing}
            aria-label={copy("chat.clear")} title={copy("chat.clear")}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6" />
            </svg>
          </button>
          <button type="button" className={`chat-voice${recording ? " chat-voice-active" : ""}`}
            onClick={() => { void toggleVoice(); }} disabled={busy || transcribing}
            aria-label={copy(recording ? "chat.voice.stop" : canRecord ? "chat.voice.start" : "chat.voice.upload")}
            title={copy(recording ? "chat.voice.stop" : canRecord ? "chat.voice.start" : "chat.voice.upload")}
            aria-pressed={recording}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8" />
            </svg>
          </button>
          <button type="submit" className="chat-send" disabled={busy || recording || transcribing || !draft.trim()} aria-label={busy ? copy("chat.sending") : copy("chat.send")}>
            {busy ? <span className="chat-spinner" aria-hidden="true" /> : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5m-6 6 6-6 6 6" />
              </svg>
            )}
          </button>
        </form>
        {voiceError && <p role="alert" className="chat-voice-error">{voiceError}</p>}
        <p className="chat-note">{copy("chat.note")}</p>
      </div>
      {voiceOpen && <VoiceDialog locale={locale} onClose={() => {
        setVoiceOpen(false);
        requestAnimationFrame(() => voiceLauncher.current?.focus());
      }} />}
    </main>
  );
}
