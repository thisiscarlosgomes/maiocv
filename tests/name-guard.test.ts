// Names the guide makes up are dropped in code ("Clínica Dentária do Maio", "Barra").
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dropUnknownNames, knownText, unknownNames } from "../lib/visitor/names.ts";

const known = knownText(["Bar restaurante Vanuza", "Cala Grande, Lda", "Praça Restaurante", "Bar Bons Amigos", "Vila do Maio", "Calheta", "Morro", "Barbearia DAD", "Hotel Big Game Maio", "Fort of São José", "Nossa Senhora da Luz", "Onda Azul Maio", "Santiago", "Praia", "Nha Terra"]);

test("a made-up clinic is dropped and the reply stays honest", () => {
  const out = dropUnknownNames("Yes — there is a dental clinic on Maio: Clínica Dentária do Maio in Vila do Maio. Ask your stay for the number.", known, "en");
  assert.deepEqual(out.dropped, ["Clínica Dentária do Maio"]);
  assert.equal(out.reply, "I don't have that listed for Maio; ask your stay or locals. Ask your stay for the number.");
});

test("a made-up village or venue the guest is sent to is dropped; listed ones stay", () => {
  const reply = "For live music in Vila do Maio try Praça Restaurante or Bar Bons Amigos. Outside Vila, check with Barra/Calheta bars like Cala Grande in Calheta.";
  const out = dropUnknownNames(reply, known, "en");
  assert.deepEqual(out.dropped, ["Barra"]);
  assert.equal(out.reply, "For live music in Vila do Maio try Praça Restaurante or Bar Bons Amigos.");
});

test("listed and background names, months and sentence starts are left alone", () => {
  for (const sentence of [
    "Bar restaurante Vanuza is a 3 min walk.",
    "Visit the Fort of São José at sunset, then Nossa Senhora da Luz.",
    "In December the wind picks up.",
    "Barbearia DAD is listed as a hairdresser.",
    "Take the ferry to Santiago and fly from Praia.",
    "Hotel Big Game Maio has a pool.",
    "Restaurante Nha Terra is in town.",
  ]) assert.deepEqual(unknownNames(sentence, known), [], sentence);
});

test("an unknown name in every sentence leaves only the honest line", () => {
  const out = dropUnknownNames("Try Yoga Studio Maio in Vila.", known, "pt");
  assert.equal(out.reply, "Não tenho isso listado para o Maio; pergunte na sua estadia ou aos locais.");
});
