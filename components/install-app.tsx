"use client";

import { useEffect, useId, useState } from "react";
import type { Locale } from "../lib/locale";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const copy = {
  pt: {
    button: "Adicionar ao ecrã principal",
    ios: "No iPhone ou iPad, abra esta página no Safari, toque em Partilhar, depois em Adicionar ao ecrã principal e em Adicionar.",
    browser: "No menu do navegador, escolha Instalar aplicação ou Adicionar ao ecrã principal. No Safari do Mac, escolha Ficheiro → Adicionar à Dock.",
    error: "Não foi possível abrir a instalação. Pode adicionar o maio.cv pelo menu do navegador.",
  },
  en: {
    button: "Add to Home Screen",
    ios: "On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen and Add.",
    browser: "In your browser’s menu, choose Install app or Add to Home Screen. In Safari on Mac, choose File → Add to Dock.",
    error: "The installation prompt couldn’t open. You can add maio.cv from your browser’s menu.",
  },
  fr: {
    button: "Ajouter à l’écran d’accueil",
    ios: "Sur iPhone ou iPad, ouvrez cette page dans Safari, touchez Partager, puis Sur l’écran d’accueil et Ajouter.",
    browser: "Dans le menu du navigateur, choisissez Installer l’application ou Ajouter à l’écran d’accueil. Dans Safari sur Mac, choisissez Fichier → Ajouter au Dock.",
    error: "L’installation n’a pas pu s’ouvrir. Vous pouvez ajouter maio.cv depuis le menu du navigateur.",
  },
};

export function InstallApp({ locale }: { locale: Locale }) {
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const helpId = useId();
  const text = copy[locale];

  useEffect(() => {
    const mode = window.matchMedia("(display-mode: standalone)");
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(mode.matches || iosStandalone);
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    const onMode = () => setInstalled(mode.matches || iosStandalone);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    mode.addEventListener("change", onMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mode.removeEventListener("change", onMode);
    };
  }, []);

  async function install() {
    setFailed(false);
    if (!prompt) {
      setShowHelp((visible) => !visible);
      return;
    }
    setBusy(true);
    setPrompt(null);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setInstalled(true);
    } catch {
      setFailed(true);
      setShowHelp(true);
    } finally {
      setBusy(false);
    }
  }

  if (installed) return null;
  return (
    <div className="install-app">
      <button className="install-app-button" type="button" onClick={() => void install()} disabled={busy} aria-busy={busy} aria-expanded={showHelp} aria-controls={helpId}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5" /></svg>
        {text.button}
      </button>
      <div id={helpId} hidden={!showHelp} className="install-app-help" role="status">
        {failed && <p className="install-app-error">{text.error}</p>}
        <p>{isIOS ? text.ios : text.browser}</p>
      </div>
    </div>
  );
}
