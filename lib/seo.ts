import type { Metadata } from "next";
import { t } from "./i18n.ts";
import { essentialsPath, essentialsSlug, LOCALES, localize, localeHreflang, localeOpenGraph, routeAlias, stripLocale, type Locale } from "./locale.ts";

export const SITE_URL = "https://www.maio.cv";
export const description = "Iniciativas digitais para a ilha do Maio, Cabo Verde: inteligência artificial, dados abertos, turismo e ferramentas para conhecer, investigar e aprender.";

// Keep search results crawlable for noindex, but omit them from the sitemap.
const pagePaths = ["/", "/faq", "/chat", "/essentials", "/sources", "/privacy", "/terms"] as const;

function basePath(path: string): string {
  const bare = stripLocale(path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  const slug = bare.slice(1);
  if (Object.values(essentialsSlug).includes(slug)) return "/essentials";
  if (slug === "mcp") return "/faq";
  if (Object.prototype.hasOwnProperty.call(routeAlias, slug)) return `/${routeAlias[slug]}`;
  return bare;
}

function localizedPath(locale: Locale, path: string): string {
  const canonicalPath = basePath(path);
  if (canonicalPath === "/essentials") return essentialsPath(locale);
  return localize(locale, canonicalPath);
}

export const publicRoutes = LOCALES.flatMap((lang) =>
  pagePaths.map((path) => ({ path: localizedPath(lang, path), lang })),
);

export const htmlLang = "pt";

export function languageAlternates(path: string) {
  const languages: Record<string, string> = {
    "x-default": new URL(localizedPath("pt", path), SITE_URL).href,
  };
  for (const locale of LOCALES) {
    languages[localeHreflang(locale)] = new URL(localizedPath(locale, path), SITE_URL).href;
  }
  return languages;
}

export function sitemapEntries() {
  return publicRoutes.map((route) => ({
    url: new URL(route.path, SITE_URL).href,
    alternates: { languages: languageAlternates(route.path) },
  }));
}

export function pageMetadata(title: string, summary: string, path: string, lang: Locale = "pt"): Metadata {
  const url = new URL(localizedPath(lang, path), SITE_URL).href;
  const index = basePath(path) !== "/search";
  const image = {
    url: `${SITE_URL}/social/maio-${lang}.png`,
    width: 1200,
    height: 630,
    alt: t("meta.image.alt", undefined, lang),
  };
  return {
    title,
    description: summary,
    alternates: { canonical: url, languages: languageAlternates(path) },
    robots: {
      index,
      follow: true,
      googleBot: { index, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
    },
    openGraph: {
      title,
      description: summary,
      url,
      siteName: "MaioCV",
      locale: localeOpenGraph(lang),
      alternateLocale: LOCALES.filter((locale) => locale !== lang).map(localeOpenGraph),
      type: "website",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: summary,
      images: [image],
    },
  };
}

export function siteSchemaFor(locale: Locale) {
  const schema = structuredClone(siteSchema);
  const website = schema["@graph"].find((node) => node["@type"] === "WebSite");
  if (website) {
    website.inLanguage = locale;
    website.description = t("meta.description.home", undefined, locale);
  }
  return schema;
}

export function faqSchema(locale: Locale, items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}${localize(locale, "/faq")}#questions`,
    url: `${SITE_URL}${localize(locale, "/faq")}`,
    inLanguage: locale,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntity: items.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

export const siteSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "MaioAzul",
      url: "https://maioazul.com",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "MaioCV",
      alternateName: "maio.cv",
      url: SITE_URL,
      description,
      inLanguage: htmlLang,
      publisher: { "@id": `${SITE_URL}/#organization` },
      about: { "@type": "Place", name: "Ilha do Maio, Cabo Verde" },
    },
  ],
};
