import { strict as assert } from "node:assert";
import { test } from "node:test";
import { t } from "../lib/i18n.ts";
import pt from "../lib/i18n/pt.json" with { type: "json" };
import en from "../lib/i18n/en.json" with { type: "json" };
import fr from "../lib/i18n/fr.json" with { type: "json" };

test("header, footer, and chat copy come from the Portuguese catalog", () => {
  assert.equal(t("cta.ask"), "Ask Maio");
  assert.equal(t("chat.thinking"), "A pensar…");
  assert.equal(t("chat.welcome"), "Olá, Maio.");
  assert.equal(t("footer.place"), "Maio, Cabo Verde");
  assert.equal(t("skip.content"), "Saltar para o conteúdo");
  assert.equal(t("footer.copyright", { year: 2026 }), "© 2026 MaioCV");
  assert.equal(t("faq.start", { cta: t("cta.ask") }), "Clique em “Ask Maio” para abrir o chat. Experimente perguntar: “Que praias existem no Maio?” Pode fazer mais perguntas na mesma conversa.");
  assert.doesNotMatch(t("cta.ask"), /Ask a question/);
  assert.doesNotMatch(t("chat.thinking"), /Thinking/);
  assert.equal(t("cta.ask", undefined, "en"), "Ask Maio");
  assert.equal(t("cta.ask", undefined, "fr"), "Ask Maio");
  assert.equal(t("lang.fr", undefined, "en"), "Français");
  assert.equal(t("i18n.notTranslated", undefined, "fr"), "Cette section n'est disponible qu'en portugais.");
  assert.equal(t("home.h1.digital", undefined, "en"), "online");
  assert.match(t("ess.verified", { date: "11 October 2026" }, "en"), /Verified on 11 October 2026 · MaioAzul/);
  assert.doesNotMatch(t("home.hero", undefined, "en"), /inteligência artificial/);
});


test("all supported languages have complete, nonempty translations and matching placeholders", () => {
  const keys = Object.keys(pt).sort();
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [locale, catalog] of Object.entries({ pt, en, fr })) {
    assert.deepEqual(Object.keys(catalog).sort(), keys, locale + " translation keys");
    for (const key of keys as (keyof typeof pt)[]) {
      assert.ok(catalog[key].trim().length > 0, locale + ": " + key);
      assert.deepEqual(placeholders(catalog[key]), placeholders(pt[key]), locale + ": " + key + " placeholders");
    }
  }
});
