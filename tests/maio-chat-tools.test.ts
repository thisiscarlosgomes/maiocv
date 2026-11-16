import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { handleMaioChat } from "../lib/maio-chat.ts";
import { clearBusinessCache } from "../lib/maio-catalog.ts";
import {
  askInstructions,
  answerGrounded,
  boatTripExperiences,
  classifyAsk,
  clearMaioChatCache,
  contactDigits,
  readExperiences,
  replyUsesListedFacts,
  type ExperienceListing,
} from "../lib/maio-chat-tools.ts";

const NOW = new Date("2026-11-16T15:00:00Z");

function feature(name: string, attributes: Record<string, unknown>, id = name) {
  return {
    type: "Feature",
    id,
    properties: { name, publicationStatus: "published", attributes: { name, ...attributes } },
  };
}

const STAYS = [
  feature("Hotel Big Game Maio", { location: "Cidade do Porto Inglês", phone: "002385977305", email: "biggamemaio@gmail.com" }),
  feature("Villa Azul", { location: "Cidade do Porto Inglês", phone: "5974467" }),
  feature("Casa do Mar", { location: "Calheta", phone: "" }),
];

const EXPERIENCES = [
  feature("Onda Azul Maio", { category: "water_sports", phone: "+238 597 11 98", price: 35, currency: "EUR", priceBasis: "person", description: { en: "Surf school and snorkelling." } }),
  feature("Big Game Sport Fishing", { category: "fishing", phone: "+238 971 05 93", price: 700, currency: "EUR", priceBasis: "group", description: { en: "Private deep-sea fishing charter." } }),
  feature("Salt pan boat", { category: "tour", phone: "+238 911 22 33", description: { en: "A small boat trip along the coast." } }),
];

const BUSINESSES = [
  feature("Praça Restaurante", { location: "Vila do Maio", phone: "", category: "food" }, "business-praca"),
  feature("Enzo Caffe Pizza", { location: "Vila do Maio", phone: "5951234", category: "food" }, "business-enzo"),
];

function boats() {
  return {
    source: "https://www.cvinterilhas.cv/routesschedules",
    sourceName: "CV Interilhas",
    status: "available",
    stale: true,
    retrievedAt: "2026-11-02T14:32:44.512Z",
    caveats: ["Published departure times are not live status."],
    schedules: [
      { date: "2026-11-18", from: "Santiago", to: "Maio", departure: "07:00", arrival: null, operator: "CV Interilhas" },
      { date: "2026-11-18", from: "Maio", to: "Santiago", departure: "10:00", arrival: null, operator: "CV Interilhas" },
      { date: "2026-11-20", from: "Santiago", to: "Maio", departure: "17:00", arrival: null, operator: "CV Interilhas" },
    ],
  };
}

function world(urls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("portal.maio.cv")) return new Response("portal", { status: 500 });
    if (url.includes("/accommodation")) return Response.json({ type: "FeatureCollection", features: STAYS });
    if (url.includes("/experiences")) return Response.json({ type: "FeatureCollection", features: EXPERIENCES });
    if (url.includes("/collections/businesses")) return Response.json({ type: "FeatureCollection", features: BUSINESSES });
    if (url.includes("/boats")) return Response.json(boats());
    if (url.includes("/flights")) return Response.json({ source: "CVSky", status: "available", stale: false, routes: {}, upcoming: { rai_mmo: [{ date: "2026-11-17", from: "RAI", to: "MMO", departure: "11:50", arrival: "12:10", flight: "7B-170", airline: "CVSky" }] }, caveats: [] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function request(question: string, lang = "en") {
  return new Request("http://localhost/api/maio-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }], context: { surface: "mcp-guide", lang } }),
  });
}

test("prompt rules keep stays, activities, and boat trips apart from the ferry", () => {
  const instructions = askInstructions("en");
  assert.match(instructions, /get_maio_accommodation/);
  assert.match(instructions, /get_maio_experiences/);
  assert.match(instructions, /boat trip is never the Santiago–Maio ferry/);
  assert.match(instructions, /Do not invent listings, operators, contacts, prices/);
  assert.equal(instructions.includes("portal.maio.cv"), false);
  assert.equal(classifyAsk("where can I stay"), "stays");
  assert.equal(classifyAsk("phone for Hotel Big Game"), "stay_contact");
  assert.equal(classifyAsk("what activities are there"), "activities");
  assert.equal(classifyAsk("boat trips around the island"), "boat_trip");
  assert.equal(classifyAsk("passeio de barco"), "boat_trip");
  assert.equal(classifyAsk("next ferry Santiago to Maio"), "ferry");
  assert.equal(classifyAsk("what time is the boat from Santiago"), "ferry");
  assert.equal(classifyAsk("next flight to Maio"), "flight");
  assert.equal(classifyAsk("phone for Praça Restaurante"), "business");
});

test("tools read the Maio API and never the portal", async () => {
  clearMaioChatCache();
  clearBusinessCache();
  const urls: string[] = [];
  const fetchImpl = world(urls);
  const stays = await answerGrounded("stays", "where can I stay", "en", fetchImpl, NOW);
  assert.match(stays.message, /Hotel Big Game Maio/);
  assert.match(stays.message, /\+238 597 73 05/);
  assert.match(stays.message, /Villa Azul/);
  assert.equal(stays.toolEvents[0]?.name, "get_maio_accommodation");
  assert.equal(stays.message.includes("10:00"), false);

  const contact = await answerGrounded("stay_contact", "phone for Hotel Big Game Maio", "en", fetchImpl, NOW);
  assert.match(contact.message, /\+238 597 73 05/);
  assert.equal(contact.message.includes("+238 597 44 67"), false);
  assert.deepEqual(contactDigits(contact.message), ["2385977305"]);

  const activities = await answerGrounded("activities", "what activities are there", "en", fetchImpl, NOW);
  assert.match(activities.message, /Onda Azul Maio/);
  assert.match(activities.message, /35 EUR/);
  assert.equal(activities.toolEvents[0]?.name, "get_maio_experiences");

  const trips = await answerGrounded("boat_trip", "boat trips", "en", fetchImpl, NOW);
  assert.match(trips.message, /Salt pan boat/);
  assert.match(trips.message, /\+238 911 22 33/);
  assert.equal(trips.message.includes("07:00"), false);
  assert.equal(trips.message.includes("17:00"), false);
  assert.equal(trips.toolEvents[0]?.name, "get_maio_experiences");
  assert.equal(trips.facts.includes("Santiago"), false);

  const ferry = await answerGrounded("ferry", "next ferry Santiago to Maio", "en", fetchImpl, NOW);
  assert.match(ferry.message, /07:00/);
  assert.match(ferry.message, /Santiago/);
  assert.equal(ferry.message.includes("10:00"), false);
  assert.equal(ferry.toolEvents[0]?.name, "get_boat_schedules");

  const business = await answerGrounded("business", "phone for Praça Restaurante", "en", fetchImpl, NOW);
  assert.match(business.message, /Praça Restaurante/);
  assert.match(business.message, /no phone number is published/i);
  assert.equal(contactDigits(business.message).length, 0);

  assert.ok(urls.length > 0);
  assert.ok(urls.every((url) => !url.includes("portal.maio.cv")));
  assert.ok(urls.some((url) => url.includes("api.maio.cv/api/v1/accommodation")));
  assert.ok(urls.some((url) => url.includes("api.maio.cv/api/v1/boats")));
});

test("a boat trip listing is an experience, and a fishing charter is not the ferry", async () => {
  clearMaioChatCache();
  const experiences = await readExperiences(world([]));
  const trips = boatTripExperiences(experiences.experiences);
  assert.deepEqual(trips.map((item) => item.name), ["Salt pan boat"]);
  const fishing = experiences.experiences.find((item) => item.name.includes("Fishing")) as ExperienceListing;
  assert.equal(boatTripExperiences([fishing]).length, 0);
  assert.equal(fishing.price?.amount, 700);
});

test("an unavailable directory does not fall back to invented listings", async () => {
  clearMaioChatCache();
  clearBusinessCache();
  const down = (async () => { throw new Error("offline"); }) as typeof fetch;
  const stays = await answerGrounded("stays", "where can I stay", "pt", down, NOW);
  assert.match(stays.message, /não está disponível/);
  assert.equal(stays.message.includes("Villa"), false);
  const business = await answerGrounded("business", "phone for Enzo Caffe Pizza", "en", down, NOW);
  assert.match(business.message, /not available/);
  assert.equal(business.message.includes("Enzo"), false);
});

test("a reply that adds a phone or a price the tools did not return is rejected", () => {
  const facts = JSON.stringify({ stays: [{ name: "Villa Azul", phone: "+238 597 44 67" }] });
  assert.equal(replyUsesListedFacts("Villa Azul: +238 597 44 67.", facts), true);
  assert.equal(replyUsesListedFacts("Call +238 999 00 00.", facts), false);
  assert.equal(replyUsesListedFacts("It costs 80 EUR.", facts), false);
  assert.equal(replyUsesListedFacts("It costs 35 EUR.", JSON.stringify({ price: { amount: 35 } })), true);
});

test("directory questions do not call the model or the portal, and a hang stays inside the fetch budget", async () => {
  clearMaioChatCache();
  const urls: string[] = [];
  const started = Date.now();
  const hung = await handleMaioChat(request("where can I stay"), {
    fetchImpl: (() => new Promise<Response>(() => {})) as typeof fetch,
    model: bomb(),
    now: NOW,
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 4_500, `elapsed ${elapsed}`);
  assert.equal(hung.status, 200);
  const hungBody = await hung.json() as { message: string };
  assert.match(hungBody.message, /won't guess/);

  clearMaioChatCache();
  clearBusinessCache();
  const response = await handleMaioChat(request("next ferry from Santiago to Maio"), {
    fetchImpl: world(urls),
    model: bomb(),
    now: NOW,
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { message: string; toolEvents: { name: string }[]; citations: { name: string }[] };
  assert.match(body.message, /07:00/);
  assert.equal(body.toolEvents[0]?.name, "get_boat_schedules");
  assert.ok(body.citations.length > 0);
  assert.ok(urls.every((url) => !url.includes("portal.maio.cv")));
});

test("the route no longer proxies to the portal", async () => {
  const route = await import("node:fs").then((fs) => fs.readFileSync(new URL("../app/api/maio-chat/route.ts", import.meta.url), "utf8"));
  assert.match(route, /maio-chat"/);
  assert.equal(route.includes("maio-chat-proxy"), false);
  assert.equal(route.includes("portal.maio.cv"), false);
});
