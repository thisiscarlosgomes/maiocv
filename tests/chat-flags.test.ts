import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { emptyTask, refreshTask } from "../lib/awareness/task.ts";
import { applyFlagIndexes, buildFlag, explicitDates, FLAG_FIELDS, FLAG_TTL_SECONDS, fold, inspectTurn, publicFlag, trimContext, type TurnForFlags } from "../lib/chat-flags.ts";
import { runPlanAgent, type PlanReplyTurn } from "../lib/plan-agent.ts";
import { buildPlan } from "../lib/trip-planner.ts";
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
  const day = inspectTurn(turn({
    botReply: "Day 2 (Tue 17 Nov): Praia do Morro, lunch, sunset.",
    planTurn: false,
    userMessage: "what's on day 2",
    cardShown: true,
  }));
  assert.equal(day.includes("plan_reemitted"), false, day.join(","));
  const lunch = inspectTurn(turn({
    botReply: "Lunch on day 2 is at 12:30.",
    planTurn: false,
    userMessage: "Where is lunch on day 2?",
    cardShown: true,
  }));
  assert.equal(lunch.includes("plan_reemitted"), false, lunch.join(","));
  const bothDays = inspectTurn(turn({
    botReply: "Day 1 is the beach at 09:00. Day 2 is lunch at 12:30.",
    planTurn: false,
    userMessage: "what's on day 2",
  }));
  assert.ok(bothDays.includes("plan_reemitted"));
  const timetable = "Flights from Maio on Sun 15 Nov: 16:55 (7B-171), 12:45 (7B-171), 15:30 (7B-171) to Praia. Published timetable, not live status.";
  const clocks = inspectTurn(turn({ botReply: timetable, planTurn: false, userMessage: "whens the next flight", cardShown: false }));
  assert.equal(clocks.includes("plan_reemitted"), false, timetable);
  const aboutOneDay = [
    ["what's on day 2", "Day 2 (Thu 19 Nov): Enzo Caffe Pizza, Morro Beach, Nha Terra, Baxona Beach."],
    ["Where is lunch on day 2?", "Lunch on day 2 is Nha Terra at 13:15."],
    ["When do I leave?", "You leave on Fri 20 Nov at 20:00."],
    ["o que há no dia 2", "Dia 2 (qui 19 nov): Enzo Caffe Pizza, Praia do Morro."],
    ["qu'est-ce qu'il y a le jour 2", "Jour 2 (jeu. 19 nov) : Enzo Caffe Pizza, plage de Morro."],
  ] as const;
  for (const [userMessage, botReply] of aboutOneDay) {
    const reasons = inspectTurn(turn({ botReply, planTurn: false, userMessage, cardShown: false }));
    assert.equal(reasons.includes("plan_reemitted"), false, botReply);
  }
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
    ["en", "The beach is calm today.", "where is the beach?", "and the hospital?"],
    ["pt", "A praia está calma hoje.", "onde fica a praia?", "e o hospital?"],
    ["fr", "La plage est calme aujourd'hui.", "où est la plage ?", "et l'hôpital ?"],
  ] as const;
  for (const [locale, botReply, previousAsk, nextAsk] of lines) {
    const stuck = inspectTurn(turn({
      locale,
      botReply,
      previousReply: botReply,
      userMessage: nextAsk,
      previousTurns: [{ role: "user", content: previousAsk }, { role: "assistant", content: botReply }],
    }));
    assert.ok(stuck.includes("repeated_reply"), locale);
    assert.equal(inspectTurn(turn({ locale, botReply, previousReply: "A different sentence here." })).includes("repeated_reply"), false);
  }
  const repeatedAsk = [
    ["en", "Export as PDF", "The print dialog is open. Save the trip as a PDF from there."],
    ["en", "Do I need a 4x4?", "I won't say a 4x4 is required, because the listings don't grade the road."],
    ["pt", "Exportar em PDF", "A janela de impressão está aberta. Guarde a viagem em PDF a partir daí."],
    ["fr", "Exporter en PDF", "La fenêtre d'impression est ouverte. Enregistrez le voyage en PDF depuis là."],
  ] as const;
  for (const [locale, userMessage, botReply] of repeatedAsk) {
    const reasons = inspectTurn(turn({
      locale,
      userMessage,
      botReply,
      previousReply: botReply,
      previousTurns: [{ role: "user", content: userMessage }, { role: "assistant", content: botReply }],
    }));
    assert.equal(reasons.includes("repeated_reply"), false, userMessage);
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

test("diff-derived replies are flagged only when the plan does not match the claim", () => {
  const before = { start: "2026-11-16", end: "2026-11-18", days: 3, car: false, pace: "slow", stops: 4 };
  const shifted = { start: "2026-11-18", end: "2026-11-20", days: 3, car: false, pace: "slow", stops: 4 };
  const moved = [
    ["en", "going on the 18th", "Moved your 3 days to Wed 18 Nov – Fri 20 Nov."],
    ["pt", "chego dia 18", "Mudei os 3 dias para qua 18 nov – sex 20 nov."],
    ["fr", "j'arrive le 18", "J'ai déplacé vos 3 jours : mer. 18 nov – ven. 20 nov."],
  ] as const;
  for (const [locale, userMessage, botReply] of moved) {
    const reasons = inspectTurn(turn({ locale, userMessage, botReply, planBefore: before, planAfter: shifted, planTurn: true }));
    assert.equal(reasons.includes("claimed_change_unchanged"), false, botReply);
    assert.equal(reasons.includes("dates_mismatch"), false, botReply);
  }
  const lengthened = { start: "2026-11-16", end: "2026-11-19", days: 4, car: true, pace: "slow", stops: 5 };
  const longer = inspectTurn(turn({
    userMessage: "add a day",
    botReply: "Your trip now runs 4 days, Mon 16 Nov to Thu 19 Nov.",
    planBefore: { ...before, car: true },
    planAfter: lengthened,
    planTurn: true,
  }));
  assert.equal(longer.includes("claimed_change_unchanged"), false);
  assert.equal(longer.includes("dates_mismatch"), false);
  const already = inspectTurn(turn({
    userMessage: "make Saturday lazier",
    botReply: "The trip already matches that.",
    planBefore: before,
    planAfter: before,
    planTurn: true,
  }));
  assert.deepEqual(already, []);
  const car = inspectTurn(turn({
    userMessage: "we rented a car",
    botReply: "Updated: with a car.",
    planBefore: before,
    planAfter: { ...before, car: true },
    planTurn: true,
  }));
  assert.equal(car.includes("claimed_change_unchanged"), false);
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

test("the reply hook sees a diff-derived move and does not flag it", async () => {
  const forecast = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"].map((date) => ({
    date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10",
  }));
  const plan = buildPlan({
    request: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: false, boatTrips: 0, pace: "slow" },
    forecast, sailings: [],
  });
  const task = refreshTask({
    ...emptyTask("en"),
    objective: plan.title,
    constraints: { dates: { start: "2026-11-16", days: 3 }, party: { adults: 2, kids: 0 }, car: false, pace: "slow" },
    completed: ["itinerary"],
  });
  const seen: PlanReplyTurn[] = [];
  const bomb = new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
  const result = await runPlanAgent(
    [{ role: "user", content: "going on the 18th" }],
    plan,
    { model: bomb, fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch, now: new Date("2026-11-15T12:00:00Z"), onReply: (turn) => seen.push(turn) },
    task,
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reply, result.reply);
  assert.match(seen[0].reply, /Moved your 3 days/);
  assert.equal(seen[0].planAfter?.days[0]?.date, "2026-11-18");
  assert.equal(seen[0].planTurn, true);
  const reasons = inspectTurn({
    surface: "plan",
    locale: "en",
    userMessage: seen[0].userMessage,
    previousTurns: seen[0].previousTurns,
    botReply: seen[0].reply,
    planBefore: seen[0].planBefore,
    planAfter: seen[0].planAfter,
    chips: seen[0].chips,
    planTurn: seen[0].planTurn,
    toolFacts: seen[0].toolFacts,
  });
  assert.equal(reasons.includes("claimed_change_unchanged"), false, reasons.join(","));
  assert.equal(reasons.includes("plan_reemitted"), false);
});
