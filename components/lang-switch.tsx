"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { LOCALES, switchPath, type Locale } from "../lib/locale";

const ownName: Record<Locale, "lang.pt" | "lang.en" | "lang.fr"> = {
  pt: "lang.pt",
  en: "lang.en",
  fr: "lang.fr",
};

export function LangSwitch({ locale, path }: { locale: Locale; path: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [extra, setExtra] = useState("");
  useEffect(() => {
    const search = path.includes("?") ? "" : window.location.search;
    setExtra(search + window.location.hash);
  }, [path]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") menu.current?.removeAttribute("open");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const links = LOCALES.map((code) => ({
    code,
    href: `${switchPath(code, path)}${extra}`,
    label: t(ownName[code], undefined, code),
  }));

  return (
    <details className="lang-switch-menu" ref={menu}>
      <summary aria-label={t("lang.switch.label", undefined, locale)} title={t("lang.switch.label", undefined, locale)}>
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 8 6 6" />
          <path d="m4 14 6-6 2-3H2" />
          <path d="M7 2h1" />
          <path d="m22 22-5-10-5 10" />
          <path d="M14 18h6" />
        </svg>
      </summary>
      <div role="group" aria-label={t("lang.switch.label", undefined, locale)}>
        {links.map((link) => (
          <a
            key={link.code}
            href={link.href}
            hrefLang={link.code}
            lang={link.code}
            aria-current={link.code === locale ? "true" : undefined}
          >
            {link.label}
          </a>
        ))}
      </div>
    </details>
  );
}
