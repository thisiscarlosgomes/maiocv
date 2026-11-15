import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyFlagIndexes, buildFlag, explicitDates, FLAG_FIELDS, FLAG_TTL_SECONDS, fold, inspectTurn, publicFlag, trimContext, type TurnForFlags } from "../lib/chat-flags.ts";
import { runPlanAgent, type PlanReplyTurn } from "../lib/plan-agent.ts";
import { scriptedModel } from "./plan/mock-model.ts";

const same = { start: "2026-11-16", end: "2026-11-18", days: 3, car: false, pace: "slow", stops: 4 };

function turn(over: Partial<TurnForFlags> = {}): TurnForFlags {
  return {
    surface: "plan",
    locale: "en",
    userMessage: "hello",
    previousTurns: [],
    botReply: "The beach is calm today.",
    planBefore: same,
    planAfter: same,
    chips: ["Add a sunset"],
    planTurn: true,
    toolFacts: "",
    ...over,
  };
}

test("claimed change with an unchanged plan is flagged in English, Portuguese, and French", () => {
  const replies = [
    ["en", "I moved the beach."],
    ["en", "Added a sunset."],
    ["en", "Removed the boat."],
    ["en", "Updated the plan."],
    ["en", "All set."],
    ["en", "Done."],
    ["pt", "Movi a praia."],
    ["pt", "Adicionei o pôr do sol."],
    ["pt", "Removi o barco."],
    ["pt", "Atualizei o plano."],
    ["pt", "Tudo pronto."],
    ["pt", "Está feito."],
    ["fr", "J'ai déplacé la plage."],
    ["fr", "J'ai ajouté le coucher de soleil."],
    ["fr", "J'ai retiré le bateau."],
    ["fr", "J'ai mis à jour le plan."],
    ["fr", "C'est bon."],
    ["fr", "C'est fait."],
  ] as const;
  for (const [locale, botReply] of replies) {
    const reasons = inspectTurn(turn({ locale, botReply }));
    assert.ok(reasons.includes("claimed_change_unchanged"), botReply);
  }
  const changed = inspectTurn(turn({ botReply: "I added a beach.", planAfter: { ...same, stops: 5 } }));
  assert.equal(changed.includes("claimed_change_unchanged"), false);
  const noCard = inspectTurn(turn({ botReply: "I added a beach.", planAfter: { ...same, stops: 5 }, cardShown: false }));
  assert.ok(noCard.includes("claimed_change_unchanged"));
});

test("denying a change while the guest asked for an edit is flagged in English, Portuguese, and French", () => {
  const cases = [
    ["en", "make it 4 days from 16 November", "I didn't change the plan."],
    ["pt", "muda para 4 dias a partir de 16 de novembro", "Não alterei o plano."],
    ["fr", "change pour 4 jours à partir du 16 novembre", "Je n'ai pas modifié le plan."],
  ] as const;
  for (const [locale, userMessage, botReply] of cases) {
    const reasons = inspectTurn(turn({ locale, userMessage, botReply, planAfter: null, planBefore: null }));
    assert.ok(reasons.includes("denied_change_with_intent"), `${locale} ${userMessage}`);
  }
  const thanks = inspectTurn(turn({ userMessage: "thanks", botReply: "I didn't change the plan.", planAfter: null, planBefore: null }));
  assert.equal(thanks.includes("denied_change_with_intent"), false);
  const obrigado = inspectTurn(turn({ locale: "pt", userMessage: "obrigado", botReply: "Não alterei o plano.", planAfter: null, planBefore: null }));
  assert.equal(obrigado.includes("denied_change_with_intent"), false);
  const merci = inspectTurn(turn({ locale: "fr", userMessage: "merci", botReply: "Je n'ai pas modifié le plan.", planAfter: null, planBefore: null }));
  assert.equal(merci.includes("denied_change_with_intent"), false);
});

test("a plan summary on a non-plan turn is flagged in English, Portuguese, and French", () => {
  const dumps = [
    ["en", "Day 1 — Mon 16 Nov\n- 09:00 Beach\n- 12:30 Lunch\n- 15:00 Salt flats\n- 18:30 Sunset"],
    ["pt", "Dia 1 — seg 16 nov\n- 09:00 Praia\n- 12:30 Almoço\n- 15:00 Salinas\n- 18:30 Pôr do sol"],
    ["fr", "Jour 1 — lun. 16 nov\n- 09:00 Plage\n- 12:30 Déjeuner\n- 15:00 Salines\n- 18:30 Coucher"],
  ] as const;
  for (const [locale, botReply] of dumps) {
    const flagged = inspectTurn(turn({ locale, botReply, planTurn: false, userMessage: "what's the hospital number?" }));
    assert.ok(flagged.includes("plan_reemitted"), locale);
    const planning = inspectTurn(turn({ locale, botReply, planTurn: true, userMessage: "3 days from 16 November" }));
    assert.equal(planning.includes("plan_reemitted"), false, locale);
  }
  const phrase = inspectTurn(turn({ botReply: "Here is the 3-day plan.", planTurn: false, userMessage: "where is the pharmacy?" }));
  assert.ok(phrase.includes("plan_reemitted"));
});

test("empty replies, fallbacks, model errors, and timeouts are flagged in English, Portuguese, and French", () => {
  assert.ok(inspectTurn(turn({ botReply: "   " })).includes("empty_reply"));
  assert.ok(inspectTurn(turn({ botReply: "", failure: "timeout" })).includes("timeout"));
  assert.ok(inspectTurn(turn({ botReply: "", failure: "model_error" })).includes("model_error"));
  const fallbacks = [
    "The planner is unavailable. Try again.",
    "An answer could not be loaded. Try again.",
    "O planeador não está disponível. Tente de novo.",
    "Não foi possível obter uma resposta. Tente novamente.",
    "Le planificateur est indisponible. Réessayez.",
    "Impossible d'obtenir une réponse. Réessayez.",
  ];
  for (const botReply of fallbacks) assert.ok(inspectTurn(turn({ botReply })).includes("generic_fallback"), botReply);
  assert.equal(inspectTurn(turn({ botReply: "The beach is calm today." })).includes("generic_fallback"), false);
});

test("plan dates that miss an explicit guest date are flagged in English, Portuguese, and French", () => {
  const later = { start: "2026-11-20", end: "2026-11-22", days: 3, car: true, pace: "slow", stops: 4 };
  const onTime = { start: "2026-11-16", end: "2026-11-18", days: 3, car: true, pace: "slow", stops: 4 };
  const mismatches = [
    ["en", "start on 16 November"],
    ["pt", "a partir de 16 de novembro"],
    ["fr", "à partir du 16 novembre"],
  ] as const;
  for (const [locale, userMessage] of mismatches) {
    const reasons = inspectTurn(turn({ locale, userMessage, botReply: "The days follow the sea.", planAfter: later, planTurn: true }));
    assert.ok(reasons.includes("dates_mismatch"), userMessage);
    const ok = inspectTurn(turn({ locale, userMessage, botReply: "The days follow the sea.", planAfter: onTime, planTurn: true }));
    assert.equal(ok.includes("dates_mismatch"), false, userMessage);
  }
  assert.deepEqual(explicitDates("3 days on Maio"), []);
  assert.equal(inspectTurn(turn({ userMessage: "3 days on Maio", botReply: "The days follow the sea.", planAfter: onTime })).includes("dates_mismatch"), false);
  assert.equal(inspectTurn(turn({ userMessage: "November 16", botReply: "The days follow the sea.", planAfter: onTime })).includes("dates_mismatch"), false);
});

test("an identical bot reply twice in a row is flagged in English, Portuguese, and French", () => {
  const lines = [
    ["en", "The beach is calm today."],
    ["pt", "A praia está calma hoje."],
    ["fr", "La plage est calme aujourd'hui."],
  ] as const;
  for (const [locale, botReply] of lines) {
    assert.ok(inspectTurn(turn({ locale, botReply, previousReply: botReply })).includes("repeated_reply"), locale);
    assert.equal(inspectTurn(turn({ locale, botReply, previousReply: "A different sentence here." })).includes("repeated_reply"), false);
  }
});

test("phones and businesses missing from the Maio result are flagged, known ones are not", () => {
  const corpus = JSON.stringify({ name: "Farmácia Central", phone: "+238 255 11 22" });
  const inventedPhone = inspectTurn(turn({ botReply: "Call the desk on +238 991 23 45.", toolFacts: corpus, planTurn: true }));
  assert.ok(inventedPhone.includes("invented_contact"));
  const listed = inspectTurn(turn({ botReply: "Farmácia Central: +238 255 11 22.", toolFacts: corpus, planTurn: true }));
  assert.equal(listed.includes("invented_contact"), false);
  const hospital = inspectTurn(turn({ botReply: "Hospital do Maio: +238 255 11 30.", toolFacts: "", planTurn: false, userMessage: "what's the hospital number?" }));
  assert.equal(hospital.includes("invented_contact"), false);
  const inventedName = inspectTurn(turn({ botReply: "Try Restaurante Inventado tonight.", toolFacts: corpus, planTurn: true }));
  assert.ok(inventedName.includes("invented_contact"));
  const known = inspectTurn(turn({ botReply: "Bar Bons Amigos is listed.", toolFacts: "", planTurn: true }));
  assert.equal(known.includes("invented_contact"), false);
  const prose = inspectTurn(turn({ botReply: "The bar is calm in the afternoon.", toolFacts: "", planTurn: true }));
  assert.equal(prose.includes("invented_contact"), false);
});

test("context keeps at most four recent turns and about 2000 characters", () => {
  const turns = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `turn-${index} ${"word ".repeat(80)}` }));
  const context = trimContext(turns);
  assert.ok(context.length <= 2000);
  assert.equal(context.includes("turn-0"), false);
  assert.equal(context.includes("turn-1"), false);
  assert.ok(context.includes("turn-5"));
});

test("flag records drop IP, user agent, cookies, and user ids", () => {
  const record = buildFlag(turn({ userMessage: "where is the beach?" }), { source: "thumbs_down", reasons: ["thumbs_down"], note: "  wrong date  " });
  const dirty = publicFlag({ ...record, ip: "203.0.113.8", userAgent: "Mozilla/5.0", cookie: "sid=abc", userId: "user-42" } as typeof record);
  const json = JSON.stringify(dirty);
  assert.equal(json.includes("203.0.113.8"), false);
  assert.equal(json.includes("Mozilla"), false);
  assert.equal(json.includes("sid=abc"), false);
  assert.equal(json.includes("user-42"), false);
  assert.equal(json.includes("userAgent"), false);
  assert.equal(json.includes("userId"), false);
  for (const key of Object.keys(dirty)) assert.ok((FLAG_FIELDS as readonly string[]).includes(key), key);
  assert.equal(dirty.note, "wrong date");
  assert.equal(dirty.source, "thumbs_down");
  assert.equal(fold("Não"), "nao");
});

test("the chat_flags TTL index is 30 days and the writer does not persist request metadata", async () => {
  assert.equal(FLAG_TTL_SECONDS, 30 * 24 * 60 * 60);
  const calls: unknown[][] = [];
  await applyFlagIndexes({ createIndex: async (...args) => { calls.push(args); } });
  assert.deepEqual(calls[0], [{ createdAt: 1 }, { expireAfterSeconds: FLAG_TTL_SECONDS }]);
  const source = readFileSync(new URL("../lib/chat-flags-mongo.ts", import.meta.url), "utf8");
  assert.match(source, /chat_flags/);
  assert.match(source, /applyFlagIndexes/);
  assert.doesNotMatch(source, /userAgent|x-forwarded-for|remoteAddress|cookie/);
});

test("the plan agent calls the reply hook once and still returns the reply", async () => {
  const seen: PlanReplyTurn[] = [];
  const result = await runPlanAgent(
    [{ role: "user", content: "hi" }],
    null,
    {
      model: scriptedModel([], "Hello from the model."),
      fetchImpl: async () => new Response("unused"),
      onReply: (turn) => seen.push(turn),
    },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reply, result.reply);
  assert.equal(seen[0].userMessage, "hi");
  assert.equal(seen[0].toolFacts.includes("unused"), false);
});
