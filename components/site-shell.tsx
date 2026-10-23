import Link from "next/link";
import { SiteFooter, SiteHeader } from "maio-ui";
import { Reveal } from "./motion";
import { LangSwitch } from "./lang-switch";
import { InstallApp } from "./install-app";
import { CHATGPT_URL } from "../lib/content";
import { t } from "../lib/i18n";
import { localize } from "../lib/locale";
import { currentLocale, currentPath } from "../lib/request-locale";

export function Logo() {
  return (
    <span className="logo">
      maio<span className="logo-dot">.</span>cv
    </span>
  );
}

export async function Header({ active = "home" }: { active?: "home" | "faq" | "essentials" | "search" | "chat" }) {
  const locale = await currentLocale();
  const path = await currentPath();
  const copy = (key: Parameters<typeof t>[0]) => t(key, undefined, locale);
  return (
    <SiteHeader
      brand={
        <Link href={localize(locale, "/")} aria-label={copy("nav.home")}>
          <Logo />
        </Link>
      }
      label={copy("nav.primary")}
      menuLabel={copy("nav.menu")}
      links={[
        { href: `${localize(locale, "/")}#iniciativas`, label: copy("nav.initiatives"), compact: "hide" },
        { href: localize(locale, "/faq"), label: copy("footer.faq"), current: active === "faq" },
        { href: localize(locale, "/chat"), label: copy("nav.chat"), current: active === "chat" },
      ]}
      tools={<LangSwitch locale={locale} path={path} />}
      action={{ href: localize(locale, "/chat"), label: copy("cta.ask"), shortLabel: copy("cta.ask.short") }}
    />
  );
}

export async function Footer() {
  const locale = await currentLocale();
  const copy = (key: Parameters<typeof t>[0], values?: Record<string, string | number>) => t(key, values, locale);
  return (
    <SiteFooter
      label={copy("footer.nav")}
      links={[
        { href: `${localize(locale, "/")}#iniciativas`, label: copy("nav.initiatives") },
        { href: `${localize(locale, "/faq")}#como-funciona`, label: copy("footer.how") },
        { href: `${localize(locale, "/faq")}#perguntas`, label: copy("footer.faq") },
        { href: CHATGPT_URL, label: copy("footer.chatgpt") },
        { href: localize(locale, "/chat"), label: copy("nav.chat") },
      ]}
      wordmark={
        <Reveal>
          <span>maio.cv</span>
        </Reveal>
      }
      meta={[
        <span key="maintainer">{copy("footer.maintained")} <a href="https://maioazul.com">{copy("footer.studio")}</a></span>,
        copy("footer.copyright", { year: new Date().getFullYear() }),
      ]}
      legal={{
        label: copy("footer.legal"),
        links: [
          { href: localize(locale, "/privacy"), label: copy("footer.privacy") },
          { href: localize(locale, "/terms"), label: copy("footer.terms") },
        ],
      }}
      tools={<InstallApp locale={locale} />}
    />
  );
}

