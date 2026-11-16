import { strict as assert } from "node:assert";
import { test } from "node:test";
import { clearBusinessCache, MAIO_API } from "../lib/maio-catalog.ts";
import { formatCapeVerdePhone } from "../lib/phone.ts";
import { answerGrounded, clearMaioChatCache, contactDigits, readBoatSchedule, readExperiences, readStays } from "../lib/maio-chat-tools.ts";

const live = process.env.MAIO_CHAT_LIVE === "0" ? test.skip : test;

live("live Maio API: stays, activities, boat trips, the next ferry, a hotel phone, and a business", { timeout: 30_000 }, async () => {
  clearMaioChatCache();
  clearBusinessCache();
  const now = new Date();

  const stays = await readStays(fetch);
  assert.equal(stays.available, true, stays.error);
  assert.ok(stays.stays.length > 0);
  const hotel = stays.stays.find((stay) => /big game/i.test(stay.name) && stay.phone);
  assert.ok(hotel?.phone, "Hotel Big Game should publish a phone");

  const where = await answerGrounded("stays", "where can I stay", "en", fetch, now);
  assert.equal(where.toolEvents[0]?.name, "get_maio_accommodation");
  assert.ok(stays.stays.some((stay) => where.message.includes(stay.name)));
  for (const digits of contactDigits(where.message)) {
    assert.ok(stays.stays.some((stay) => stay.phone && contactDigits(stay.phone).includes(digits)), digits);
  }

  const experiences = await readExperiences(fetch);
  assert.equal(experiences.available, true, experiences.error);
  assert.ok(experiences.experiences.length > 0);
  const activities = await answerGrounded("activities", "what activities can I do", "en", fetch, now);
  assert.equal(activities.toolEvents[0]?.name, "get_maio_experiences");
  assert.ok(experiences.experiences.some((item) => activities.message.includes(item.name)));
  for (const digits of contactDigits(activities.message)) {
    assert.ok(experiences.experiences.some((item) => item.phone && contactDigits(item.phone).includes(digits)), digits);
  }

  const trips = await answerGrounded("boat_trip", "boat trips", "en", fetch, now);
  assert.equal(trips.toolEvents[0]?.name, "get_maio_experiences");
  assert.equal(trips.toolEvents.some((item) => item.name === "get_boat_schedules"), false);
  assert.equal(/\b\d{2}:\d{2}\b/.test(trips.message), false, trips.message);
  assert.equal(/07:00|17:00|10:00/.test(trips.message), false);
  if (/does not list a boat trip/i.test(trips.message)) {
    assert.equal(contactDigits(trips.message).length, 0);
  } else {
    assert.ok(experiences.experiences.some((item) => trips.message.includes(item.name)));
  }

  const boats = await readBoatSchedule(fetch, now);
  assert.equal(boats.available, true, boats.error);
  const ferry = await answerGrounded("ferry", "next ferry Santiago to Maio", "en", fetch, now);
  assert.equal(ferry.toolEvents[0]?.name, "get_boat_schedules");
  if (boats.nextSantiagoToMaio) {
    assert.match(ferry.message, new RegExp(boats.nextSantiagoToMaio.departure));
    assert.match(ferry.message, /Santiago/);
    assert.equal(ferry.message.includes("10:00") && boats.nextSantiagoToMaio.departure !== "10:00", false);
  } else {
    assert.match(ferry.message, /won't invent a time/);
  }

  const contact = await answerGrounded("stay_contact", `phone for ${hotel!.name}`, "en", fetch, now);
  assert.match(contact.message, new RegExp(hotel!.phone!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const expected = contactDigits(hotel!.phone!);
  assert.deepEqual(contactDigits(contact.message), expected);
  const raw = await fetch(`${MAIO_API}/accommodation?limit=100`).then((response) => response.json()) as { features?: { properties?: { attributes?: { name?: string; phone?: string } } }[] };
  const apiPhone = raw.features?.map((item) => item.properties?.attributes).find((attrs) => attrs?.name === hotel!.name)?.phone ?? "";
  assert.equal(hotel!.phone, formatCapeVerdePhone(apiPhone));

  const business = await answerGrounded("business", "Praça Restaurante", "en", fetch, now);
  assert.equal(business.toolEvents[0]?.name, "get_business");
  assert.match(business.message, /Praça Restaurante/);
  assert.equal(contactDigits(business.message).length, 0);
  assert.equal(business.message.includes("portal.maio.cv"), false);
  assert.equal(where.message.includes("portal.maio.cv"), false);
});
