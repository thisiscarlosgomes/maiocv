import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { gatewayReady, languageModel, modelReady, openaiReady, withFallback } from "../lib/ai-model.ts";

const OPTIONS = { prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as unknown as LanguageModelV4CallOptions;

function fake(name: string, outcome: "ok" | "fail", seen: string[]): LanguageModelV4 {
  const run = async () => {
    seen.push(name);
    if (outcome === "fail") throw Object.assign(new Error(`${name} down`), { statusCode: 500 });
    return { content: [{ type: "text", text: name }], finishReason: "stop", usage: {}, warnings: [] } as never;
  };
  return { specificationVersion: "v4", provider: name, modelId: name, supportedUrls: {}, doGenerate: run, doStream: run };
}

test("with OPENAI_API_KEY the call goes to OpenAI by its bare id", () => {
  const model = languageModel("openai/gpt-5-mini", { OPENAI_API_KEY: "sk-test" });
  assert.match(model.provider, /^openai/);
  assert.equal(model.modelId, "gpt-5-mini");
});

test("without the key it is the AI Gateway, as before", () => {
  const model = languageModel("openai/gpt-5-nano", { VERCEL_OIDC_TOKEN: "x" });
  assert.equal(model.provider, "gateway");
  assert.equal(model.modelId, "openai/gpt-5-nano");
});

test("a non-OpenAI id stays on the gateway even with the key", () => {
  const model = languageModel("anthropic/claude-haiku-4.5", { OPENAI_API_KEY: "sk-test", VERCEL_OIDC_TOKEN: "x" });
  assert.equal(model.provider, "gateway");
});

test("readiness counts either route", () => {
  assert.equal(openaiReady({ OPENAI_API_KEY: " " }), false);
  assert.equal(modelReady({ OPENAI_API_KEY: "sk-test" }), true);
  assert.equal(modelReady({ AI_GATEWAY_API_KEY: "k" }), true);
  assert.equal(gatewayReady({ OPENAI_API_KEY: "sk-test" }), false);
  assert.equal(modelReady({}), false);
});

test("a failed OpenAI call is retried once on the gateway", async () => {
  const seen: string[] = [];
  const errors: unknown[] = [];
  const model = withFallback(fake("openai", "fail", seen), fake("gateway", "ok", seen), (error) => errors.push(error));
  const result = await model.doGenerate(OPTIONS) as unknown as { content: { text: string }[] };
  assert.deepEqual(seen, ["openai", "gateway"]);
  assert.equal(result.content[0].text, "gateway");
  assert.equal(errors.length, 1);
});

test("a working OpenAI call never touches the gateway", async () => {
  const seen: string[] = [];
  const model = withFallback(fake("openai", "ok", seen), fake("gateway", "ok", seen));
  await model.doGenerate(OPTIONS);
  assert.deepEqual(seen, ["openai"]);
});

test("the caller's own abort is not retried", async () => {
  const seen: string[] = [];
  const controller = new AbortController();
  controller.abort();
  const model = withFallback(fake("openai", "fail", seen), fake("gateway", "ok", seen));
  await assert.rejects(async () => model.doGenerate({ ...OPTIONS, abortSignal: controller.signal }));
  assert.deepEqual(seen, ["openai"]);
});
