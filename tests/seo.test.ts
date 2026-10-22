import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { LOCALES } from "../lib/locale.ts";
import { t } from "../lib/i18n.ts";
import { faqSchema, htmlLang, languageAlternates, pageMetadata, publicRoutes, sitemapEntries, siteSchemaFor } from "../lib/seo.ts";

const base = "https://www.maio.cv";

test("the sitemap contains canonical indexable pages in all supported languages", () => {
  assert.equal(htmlLang, "pt");
  assert.deepEqual(publicRoutes.map((route) => route.path), [
    "/pt", "/pt/faq", "/pt/chat", "/pt/essenciais", "/pt/sources",
    "/en", "/en/faq", "/en/chat", "/en/essentials", "/en/sources",
    "/fr", "/fr/faq", "/fr/chat", "/fr/essentiels", "/fr/sources",
  ]);
  const entries = sitemapEntries();
  assert.equal(entries.length, 15);
  assert.equal(new Set(entries.map(({ url }) => url)).size, 15);
  for (const [index, entry] of entries.entries()) {
    const route = publicRoutes[index];
    assert.equal(entry.url, `${base}${route.path}`);
    assert.equal(entry.alternates.languages[route.lang], entry.url);
    assert.doesNotMatch(entry.url, /search|mcp|\?|#/);
  }
});

test("hreflang normalizes translated slugs, aliases, trailing slashes, and query strings", () => {
  const expected = {
    "x-default": `${base}/pt/essenciais`,
    pt: `${base}/pt/essenciais`,
    en: `${base}/en/essentials`,
    fr: `${base}/fr/essentiels`,
  };
  for (const path of ["/essentials", "/pt/essenciais", "/en/essentials/", "/fr/essentiels?from=chat#arrive", "/en/visit"]) {
    assert.deepEqual(languageAlternates(path), expected);
  }
  assert.deepEqual(languageAlternates("/en/mcp"), languageAlternates("/faq"));
  assert.equal(languageAlternates("/en/chat").fr, `${base}/fr/chat`);
});

test("page metadata produces clean canonical URLs and localized social cards", () => {
  for (const locale of LOCALES) {
    const meta = pageMetadata("title", "summary", `/${locale}/chat?question=hello#answer`, locale);
    assert.equal(meta.alternates?.canonical, `${base}/${locale}/chat`);
    assert.equal(meta.openGraph && "url" in meta.openGraph ? meta.openGraph.url : undefined, `${base}/${locale}/chat`);
    assert.ok(meta.openGraph && "images" in meta.openGraph);
    const images = meta.openGraph.images as { url: string; width: number; height: number; alt: string }[];
    assert.equal(images[0]?.url, `${base}/social/maio-${locale}.png`);
    assert.equal(images[0]?.width, 1200);
    assert.equal(images[0]?.height, 630);
    assert.equal(images[0]?.alt, t("meta.image.alt", undefined, locale));
    assert.ok(existsSync(new URL(`../public/social/maio-${locale}.png`, import.meta.url)));
    assert.ok(meta.robots && typeof meta.robots === "object" && meta.robots.index === true);
  }
});

test("internal search pages are noindex, including query variations and aliases", () => {
  for (const path of ["/search", "/en/search?q=beach", "/fr/recherche"]) {
    const meta = pageMetadata("Search", "Search places", path, "en");
    assert.equal(meta.alternates?.canonical, `${base}/en/search`);
    assert.ok(meta.robots && typeof meta.robots === "object" && meta.robots.index === false && meta.robots.follow === true);
  }
});

test("structured data uses translated site descriptions without leaking locale state", () => {
  for (const locale of ["en", "fr", "pt"] as const) {
    const website = siteSchemaFor(locale)["@graph"].find(node => node["@type"] === "WebSite");
    assert.equal(website?.inLanguage, locale);
    assert.equal(website?.description, t("meta.description.home", undefined, locale));
    assert.equal(website?.url, base);
  }
});

test("FAQ structured data keeps the exact displayed questions and answers", () => {
  const items = [{ question: "How do I start?", answer: "Open the chat and ask about Maio." }];
  const schema = faqSchema("en", items);
  assert.equal(schema.url, `${base}/en/faq`);
  assert.equal(schema.inLanguage, "en");
  assert.deepEqual(schema.mainEntity, [{
    "@type": "Question",
    name: items[0].question,
    acceptedAnswer: { "@type": "Answer", text: items[0].answer },
  }]);
});
