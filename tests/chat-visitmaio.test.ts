import { strict as assert } from "node:assert";
import { test } from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { remarkVisitMaioLinks } from "../lib/chat-visitmaio.ts";

test("links VisitMaio mentions in answers while preserving code and existing links", () => {
  const markdown = "Fonte: dados do VisitMaio.\n\n`VisitMaio` [VisitMaio](https://visitmaio.com/) visitmaio.com";
  const tree = unified().use(remarkParse).use(remarkVisitMaioLinks).runSync(unified().use(remarkParse).parse(markdown));
  const links = JSON.stringify(tree).match(/"url":"https:\/\/visitmaio\.com\/"/g) ?? [];
  assert.equal(links.length, 2);
  assert.match(JSON.stringify(tree), /"type":"inlineCode","value":"VisitMaio"/);
  assert.match(JSON.stringify(tree), /visitmaio\.com/);
});
