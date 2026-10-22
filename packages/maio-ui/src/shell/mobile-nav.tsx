"use client";

import { useEffect, useRef } from "react";

type MobileLink = {
  href: string;
  label: string;
  current?: boolean;
};

export function MobileNav({ label, links }: { label: string; links: MobileLink[] }) {
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") menu.current?.removeAttribute("open");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <details className="maio-mobile-nav" ref={menu}>
      <summary aria-label={label}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </summary>
      <nav aria-label={label}>
        {links.map((link) => (
          <a key={link.href} href={link.href} aria-current={link.current ? "page" : undefined}
            onClick={() => menu.current?.removeAttribute("open")}>
            {link.label}
          </a>
        ))}
      </nav>
    </details>
  );
}
