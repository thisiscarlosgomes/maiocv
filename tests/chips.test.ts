import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { emptyTask, followUpChips, isGuestChip, refreshTask, type Task } from "../lib/awareness/task.ts";
import { planStrings } from "../lib/trip-strings.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import { cardView } from "../lib/trip-view.ts";

const forecast = [
  { date: "2026-11-16", waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" },
  { date: "2026-11-17", waveHeightM: 0.7, windKmh: 14, tempMaxC: 28, sunset: "18:10" },
];

function planned(locale: "en" | "pt" | "fr", extra: Task["constraints"] = {}): Task {
  const task = emptyTask(locale);
  task.objective = "a trip";
  task.completed = ["itinerary"];
  task.constraints = { dates: { start: "2026-11-16", days: 3 }, party: { adults: 2, kids: 0 }, car: true, ...extra };
  return refreshTask(task);
}

test("chips are guest messages, and a question mark is a question to the assistant", () => {
  const cases = [
    emptyTask("en"),
    emptyTask("pt"),
    emptyTask("fr"),
    planned("en"),
    planned("pt", { car: false }),
    planned("fr", { boatTrips: 1 }),
  ];
  for (const task of cases) {
    const chips = followUpChips(task);
    assert.ok(chips.length >= 1 && chips.length <= 3, chips.join(" | "));
    for (const chip of chips) {
      assert.ok(isGuestChip(chip), chip);
      assert.doesNotMatch(chip, /when do you|who is coming|will you have|quantos dias vai|quem vem|quando chega|aurez-vous|qui vient|quand arrivez/i);
    }
  }
});

test("a finished plan does not ask for dates or party again", () => {
  for (const locale of ["en", "pt", "fr"] as const) {
    const chips = followUpChips(planned(locale));
    assert.ok(chips.some((chip) => /relax|calmo|calme/i.test(chip)), chips.join(" | "));
    assert.ok(chips.every((chip) => !/3 days|3 dias|3 jours/i.test(chip)));
    assert.ok(chips.every((chip) => !/2 adults|2 adultos|2 adultes/i.test(chip)));
    assert.equal(planStrings[locale].ask.length > 0, true);
    assert.match(planStrings[locale].ask, locale === "en" ? /change your trip/i : locale === "pt" ? /mudar a viagem/i : /changer le voyage/i);
  }
});

test("no car after a plan offers a rental question, not a repeated 'no car'", () => {
  const chips = followUpChips(planned("en", { car: false }));
  assert.ok(chips.includes("Where can I rent a car?"));
  assert.ok(chips.every((chip) => !/^no car$/i.test(chip)));
});

test("ask maio suggestion labels are guest voice in every language", () => {
  for (const locale of ["en", "pt", "fr"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../lib/i18n/${locale}.json`, import.meta.url), "utf8")) as Record<string, string>;
    const labels = Object.entries(catalog).filter(([key]) => key.startsWith("chat.suggest.") && !key.endsWith(".prompt"));
    assert.ok(labels.length >= 6);
    for (const [key, label] of labels) {
      assert.ok(isGuestChip(label), `${locale} ${key}: ${label}`);
      assert.doesNotMatch(label, /when do you|will you have|quem vem|aurez-vous une voiture/i);
    }
  }
});

test("a departure row is just Depart, without an unpublished-time aside", () => {
  const plan = buildPlan({
    request: { startDate: "2026-11-16", days: 2, locale: "en", adults: 2, hasCar: false, boatTrips: 0, departure: { mode: "flight", time: "17:30" } },
    forecast,
    sailings: [],
  });
  const row = plan.days.at(-1)!.items.find((item) => item.slot === "departure");
  assert.ok(row);
  const view = cardView(row!, "en", planStrings.en);
  assert.equal(view?.title, "Depart");
  assert.doesNotMatch(`${view?.title} ${view?.meta}`, /published|not set|\(/i);
  const pt = cardView(row!, "pt", planStrings.pt);
  const fr = cardView(row!, "fr", planStrings.fr);
  assert.equal(pt?.title, "Partida");
  assert.equal(fr?.title, "Départ");
});
