"use client";

import { useEffect, useLayoutEffect, useRef, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChatMarkdown } from "../chat-markdown";
import type { ChatAdapter } from "./adapter";

/**
 * One transcript, one composer, one typing row. Ask Maio and /plan both render this.
 * The adapter decides where a send goes; the shell only presents it.
 */
export function ChatShell({
  locale, welcome, logLabel, placeholder, thinking, sendLabel, sendingLabel, inputId, note,
  suggestions, suggestionsWhen = "empty", messages, draft, busy, error, onDraft, onSend,
  onClear, clearLabel, clearVariant = "icon", composerLeading, composerExtras, aboveComposer,
  belowComposer, stage, composer = true, className, children, onFollowUp, inputLocked = false,
}: ChatAdapter) {
  const reduced = useReducedMotion();
  const pane = useRef<HTMLDivElement>(null);
  const question = useRef<HTMLElement | null>(null);
  const tail = useRef<HTMLDivElement>(null);
  const seen = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null);
  /** Keep the latest question at the top until the guest scrolls away. */
  const pin = useRef(false);
  const guestMoved = useRef(false);
  const scrolling = useRef(false);
  let questionIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].role === "user") { questionIndex = i; break; }

  useEffect(() => {
    const screen = pane.current?.closest<HTMLElement>(".chat-screen");
    const viewport = window.visualViewport;
    if (!screen || !viewport) return;
    let frame = 0;
    const syncViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
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

  function pinQuestion() {
    const node = pane.current;
    const target = question.current;
    const spacer = tail.current;
    if (!node || !spacer) return;
    spacer.style.height = "0px";
    if (!target || !pin.current || guestMoved.current || stage) return;
    const top = node.scrollTop + target.getBoundingClientRect().top - node.getBoundingClientRect().top;
    const below = node.scrollHeight - top;
    spacer.style.height = `${Math.max(0, node.clientHeight - below + 12)}px`;
    const next = Math.max(0, top - 12);
    if (Math.abs(node.scrollTop - next) < 2) return;
    scrolling.current = true;
    node.scrollTop = next;
    requestAnimationFrame(() => { scrolling.current = false; });
  }

  useEffect(() => {
    const node = pane.current;
    if (!node) return;
    const mark = () => { if (!scrolling.current) guestMoved.current = true; };
    node.addEventListener("wheel", mark, { passive: true });
    node.addEventListener("touchmove", mark, { passive: true });
    const observer = new ResizeObserver(() => pinQuestion());
    observer.observe(node);
    return () => {
      node.removeEventListener("wheel", mark);
      node.removeEventListener("touchmove", mark);
      observer.disconnect();
    };
  }, [stage]);

  useEffect(() => {
    const input = field.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  }, [draft]);

  useEffect(() => {
    if (!busy) field.current?.focus({ preventScroll: true });
  }, [busy]);

  useEffect(() => {
    if (messages.length === 0) field.current?.focus({ preventScroll: true });
  }, [messages.length]);

  useLayoutEffect(() => {
    const previous = seen.current;
    const added = messages.length > previous ? messages.slice(previous) : [];
    seen.current = messages.length;
    if (added.some((message) => message.role === "user")) {
      pin.current = true;
      guestMoved.current = false;
    }
    if (messages.length === 0) pin.current = false;
    pinQuestion();
  }, [messages, busy, error, stage]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && !inputLocked && draft.trim()) onSend(draft);
  }

  const showWelcome = !stage && messages.length === 0 && !busy;
  const showDockSuggestions = suggestionsWhen === "always" && suggestions.length > 0 && !busy && !stage;

  return (
    <main id="conteudo" lang={locale} className={`chat-page${className ? ` ${className}` : ""}`}>
      <div ref={pane} className={`chat-conversation${showWelcome ? " chat-conversation-empty" : ""}`}>
        {messages.length || busy || stage ? <h1 className="sr-only">{welcome}</h1> : null}
        {clearVariant === "text" && onClear && (messages.length > 0 || stage) && (
          <button type="button" className="plan-back" onClick={onClear}>{clearLabel}</button>
        )}
        {showWelcome && (
          <div className="chat-welcome">
            <h1>{welcome}</h1>
            {suggestions.length > 0 && (
              <div className="chat-suggestions" data-testid="suggestions">
                {suggestions.map(({ label, prompt }) => (
                  <button key={label} type="button" disabled={busy} onClick={() => onSend(label, prompt)}>{label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {stage ?? (
          <div role="log" aria-label={logLabel} aria-live="polite" aria-relevant="additions" data-testid="chat-log">
            {messages.map((message, index) => (
              <motion.article key={index}
                ref={index === questionIndex ? (node) => { question.current = node; } : undefined}
                className={`chat-message chat-message-${message.role}`}
                data-testid={message.role === "assistant" ? "assistant-reply" : "user-message"}
                initial={reduced ? false : message.role === "user" ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                {message.lead}
                {message.body ?? (message.role === "assistant"
                  ? <ChatMarkdown content={message.content}
                      onFollowUp={onFollowUp && index === messages.length - 1 ? onFollowUp : undefined}
                      disabled={busy || inputLocked} />
                  : <p>{message.content}</p>)}
                {message.extra}
              </motion.article>
            ))}
          </div>
        )}
        {busy && thinking.trim() && (
          <div role="status" className="chat-status chat-thinking" data-testid="typing">
            <span className="thinking-dots" aria-hidden="true"><span /><span /><span /></span>
            <span className="thinking-label">{thinking}</span>
          </div>
        )}
        {error && <p role="alert" className="chat-error">{error}</p>}
        <div ref={tail} className="chat-scroll-tail" aria-hidden="true" />
      </div>
      {showDockSuggestions && (
        <div className="chat-suggestions chat-suggestions-dock" data-testid="suggestions">
          {suggestions.map(({ label, prompt }) => (
            <button key={label} type="button" disabled={busy} onClick={() => onSend(label, prompt)}>{label}</button>
          ))}
        </div>
      )}
      {composer && (
        <div className="chat-composer-wrap">
          {aboveComposer}
          <form className="chat-composer" onSubmit={submit}>
            {composerLeading}
            <label className="sr-only" htmlFor={inputId}>{placeholder}</label>
            <textarea id={inputId} ref={field} data-testid="chat-input" value={draft} maxLength={2000} enterKeyHint="send"
              placeholder={placeholder} rows={1} readOnly={busy || inputLocked}
              onChange={(event) => onDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (!busy && !inputLocked && draft.trim()) onSend(draft);
                }
              }} />
            {clearVariant === "icon" && onClear && (
              <button type="button" className="chat-clear" onClick={onClear}
                disabled={!messages.length && !draft && !busy && !error}
                aria-label={clearLabel} title={clearLabel}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6" />
                </svg>
              </button>
            )}
            {composerExtras}
            <button type="submit" className="chat-send" data-testid="chat-send" disabled={busy || inputLocked || !draft.trim()} aria-label={busy ? sendingLabel : sendLabel}>
              {busy ? <span className="chat-spinner" aria-hidden="true" /> : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19V5m-6 6 6-6 6 6" />
                </svg>
              )}
            </button>
          </form>
          {belowComposer}
          {note && <p className="chat-note">{note}</p>}
        </div>
      )}
      {children}
    </main>
  );
}
