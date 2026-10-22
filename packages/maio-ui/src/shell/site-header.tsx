import type { ReactNode } from "react";
import { Button } from "../primitives/button";
import { MobileNav } from "./mobile-nav";

export type HeaderLink = {
  href: string;
  label: string;
  current?: boolean;
  compact?: "hide";
};

export function SiteHeader({
  brand,
  label,
  menuLabel,
  links,
  tools,
  action,
}: {
  brand: ReactNode;
  label: string;
  menuLabel?: string;
  links: HeaderLink[];
  tools?: ReactNode;
  action?: { href: string; label: string; shortLabel: string };
}) {
  return (
    <header className="maio-header" id="topo">
      {brand}
      <nav className="maio-header-nav" aria-label={label}>
        {links.map((link) => (
          <a key={link.href} href={link.href} aria-current={link.current ? "page" : undefined} data-compact={link.compact}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="maio-header-actions">
        {tools}
        {action ? (
          <Button href={action.href} size="small" aria-label={action.label}>
            <span className="maio-action-full" aria-hidden="true">{action.label}</span>
            <span className="maio-action-short" aria-hidden="true">{action.shortLabel}</span>
          </Button>
        ) : null}
      </div>
      <MobileNav label={label} menuLabel={menuLabel} links={links} />
    </header>
  );
}
