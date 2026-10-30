"use client";

import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { t } from "../lib/i18n";
import type { Locale } from "../lib/locale";

const loadVoice = () => import("./voice-conversation").then(module => ({ default: module.VoiceConversation }));
const VoiceConversation = lazy(loadVoice);

export function preloadVoiceConversation() {
  // Warm the SDK on intent without requesting a token or microphone access.
  void loadVoice().catch(() => {});
}

export function VoiceDialog({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="voice-dialog" aria-label="Ask Maio"
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <Suspense fallback={
        <div className="voice-panel">
          <header className="voice-header">
            <h2>Ask Maio</h2>
            <button type="button" className="voice-close" onClick={onClose} aria-label={t("voice.close", undefined, locale)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>
          <div className="voice-stage" aria-busy="true">
            <div className="voice-orb" aria-hidden="true"><span className="voice-orb-gradient" /><span className="voice-orb-grain" /></div>
            <p className="voice-state" role="status">{t("voice.loading", undefined, locale)}</p>
          </div>
        </div>
      }>
        <VoiceConversation locale={locale} onClose={onClose} />
      </Suspense>
    </dialog>
  );
}
