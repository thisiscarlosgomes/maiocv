import type { ReactNode } from "react";

export type FooterLink = { href: string; label: string };

export function SiteFooter({
  label,
  links,
  wordmark,
  meta,
  legal,
  credit,
  tools,
}: {
  label: string;
  links: FooterLink[];
  wordmark: ReactNode;
  meta: ReactNode[];
  legal?: { label: string; links: FooterLink[] };
  credit?: ReactNode;
  tools?: ReactNode;
}) {
  return (
    <footer className="maio-footer">
      <nav className="maio-footer-links" aria-label={label}>
        {links.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="maio-footer-wordmark" aria-hidden="true">
        {wordmark}
      </div>
      <div className="maio-footer-meta">
        {meta.map((item, index) => (
          <span key={index}>{item}</span>
        ))}
      </div>
      {legal ? (
        <nav className="maio-footer-legal" aria-label={legal.label}>
          {legal.links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
        </nav>
      ) : null}
      {tools}
      {credit ? <p className="maio-footer-credit">{credit}</p> : null}
    </footer>
  );
}
