import { strict as assert } from "node:assert";
import { test } from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import { remarkChatFollowUps } from "../lib/chat-followups.ts";

function marked(content: string) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkChatFollowUps);
  const tree = processor.runSync(processor.parse(content)) as Root;
  const prompts = tree.children.flatMap(node => node.type === "list"
    ? node.children.flatMap(item => item.data?.hProperties?.["data-follow-up"] ?? []) : []);
  return { tree, prompts };
}

test("turns the supplied Portuguese follow-ups into clean prompts, preserving the answer and source", () => {
  const content = `O Maio recebeu turistas em 2024.

Se quiser, posso também:

1. comparar **Maio, Sal e Boa Vista**, ou
2. calcular a **percentagem de turistas** de cada ilha no total nacional.

Fonte: INE Cabo Verde`;
  const { tree, prompts } = marked(content);
  assert.deepEqual(prompts, ["Comparar Maio, Sal e Boa Vista", "Calcular a percentagem de turistas de cada ilha no total nacional"]);
  assert.equal(tree.children[0].type, "paragraph");
  assert.equal(tree.children.at(-1)?.type, "paragraph");
});

test("supports English and French intros, bold headings, bullets and wrapped suggestions", () => {
  assert.deepEqual(marked("**If you’d like, I can also:**\n\n- compare the islands, or\n- plan a beach day.").prompts,
    ["Compare the islands", "Plan a beach day"]);
  assert.deepEqual(marked("### Si vous le souhaitez, je peux aussi :\n\n1. comparer Maio et Sal, ou\n2. préparer un itinéraire\n   pour une journée.").prompts,
    ["Comparer Maio et Sal", "Préparer un itinéraire pour une journée"]);
});

test("leaves ordinary lists, quotes, code, tasks and nested answers alone", () => {
  for (const content of [
    "Beach itinerary:\n\n1. Start at Vila do Maio.\n2. Walk to the beach.",
    "> If you'd like, I can also:\n>\n> 1. Compare the islands.",
    "```\nSe quiser, posso também:\n1. comparar as ilhas\n```",
    "If you'd like, I can also:\n\n- [ ] Compare the islands.",
    "Se quiser, posso também:\n\n1. comparar as ilhas\n   - Maio\n   - Sal",
    "Next steps:\n\n1. Open the map.\n2. Select a place.",
  ]) assert.deepEqual(marked(content).prompts, []);
});
