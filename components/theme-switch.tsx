"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import type { Locale } from "../lib/locale";

type Theme = "system" | "light" | "dark";
const valid = (value: string | null): Theme => value === "light" || value === "dark" || value === "system" ? value : "dark";

export function ThemeSwitch({ locale }: { locale: Locale }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (choice: Theme) => {
      const dark = choice === "dark" || (choice === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#141416" : "#ffffff");
      setTheme(choice);
    };
    const read = () => {
      let choice: Theme = "dark";
      try { choice = valid(localStorage.getItem("maio-theme")); } catch { /* Default to dark without storage. */ }
      apply(choice);
    };
    const onStorage = (event: StorageEvent) => { if (event.key === "maio-theme" || event.key === null) read(); };
    read();
    media.addEventListener("change", read);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", read);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.removeAttribute("open");
        menu.current.querySelector("summary")?.focus();
      }
    };
    const onOutside = (event: Event) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) menu.current?.removeAttribute("open");
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, []);

  function choose(choice: Theme) {
    try { localStorage.setItem("maio-theme", choice); } catch { /* Apply for this page even if storage is blocked. */ }
    setTheme(choice);
    const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#141416" : "#ffffff");
    menu.current?.removeAttribute("open");
    menu.current?.querySelector("summary")?.focus();
  }

  return <details className="lang-switch-menu" ref={menu}>
    <summary aria-label={t("theme.label", undefined, locale)} title={t("theme.label", undefined, locale)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></svg>
    </summary>
    <div role="group" aria-label={t("theme.label", undefined, locale)}>
      {(["system", "light", "dark"] as const).map(choice => (
        <button key={choice} type="button" aria-pressed={theme === choice} onClick={() => choose(choice)}>
          {t(`theme.${choice}`, undefined, locale)}
        </button>
      ))}
    </div>
  </details>;
}
