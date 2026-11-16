import { gateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";

type Env = Record<string, string | undefined>;

/** The AI Gateway can authenticate (local key or Vercel OIDC). */
export function gatewayReady(env: Env = process.env): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
}

/** Direct OpenAI is configured. */
export function openaiReady(env: Env = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

/** Some model can answer: direct OpenAI first, the AI Gateway as fallback. */
export function modelReady(env: Env = process.env): boolean {
  return openaiReady(env) || gatewayReady(env);
}

/** "openai/gpt-5-mini" is "gpt-5-mini" on OpenAI. Other providers have no direct route. */
function openaiId(id: string): string | null {
  const [provider, ...rest] = id.split("/");
  if (rest.length === 0) return provider;
  return provider === "openai" ? rest.join("/") : null;
}

/** GPT-5 family on minimal reasoning: about 1s a reply instead of 5s, inside the planner's 4.5s model clock. */
function withReasoning(options: LanguageModelV4CallOptions, id: string, env: Env): LanguageModelV4CallOptions {
  if (!/^gpt-5/.test(id)) return options;
  const openai = (options.providerOptions?.openai ?? {}) as Record<string, unknown>;
  if (openai.reasoningEffort) return options;
  const effort = env.OPENAI_REASONING_EFFORT?.trim() || "minimal";
  return { ...options, providerOptions: { ...options.providerOptions, openai: { ...openai, reasoningEffort: effort } } };
}

/** Try `primary`; on any error except the caller's own abort, run the same call on `fallback`. */
export function withFallback(primary: LanguageModelV4, fallback: LanguageModelV4, onFallback?: (error: unknown) => void): LanguageModelV4 {
  const retry = async <T>(options: LanguageModelV4CallOptions, run: (model: LanguageModelV4) => PromiseLike<T>): Promise<T> => {
    try {
      return await run(primary);
    } catch (error) {
      if (options.abortSignal?.aborted) throw error;
      onFallback?.(error);
      return await run(fallback);
    }
  };
  return {
    specificationVersion: "v4",
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    doGenerate: (options) => retry(options, (model) => model.doGenerate(options)),
    doStream: (options) => retry(options, (model) => model.doStream(options)),
  };
}

function directOpenAI(id: string, env: Env): LanguageModelV4 {
  const base = createOpenAI({ apiKey: env.OPENAI_API_KEY!.trim() })(id) as LanguageModelV4;
  return {
    specificationVersion: "v4",
    provider: base.provider,
    modelId: base.modelId,
    supportedUrls: base.supportedUrls,
    doGenerate: (options) => base.doGenerate(withReasoning(options, id, env)),
    doStream: (options) => base.doStream(withReasoning(options, id, env)),
  };
}

/**
 * One model id (gateway form, "openai/gpt-5-mini") for every call site. With OPENAI_API_KEY the call
 * goes straight to OpenAI and falls back to the AI Gateway when that fails and the gateway can sign in.
 * Without the key it is the gateway, as before.
 */
export function languageModel(id: string, env: Env = process.env): LanguageModelV4 {
  const direct = openaiReady(env) ? openaiId(id) : null;
  if (!direct) return gateway(id) as LanguageModelV4;
  const openai = directOpenAI(direct, env);
  if (!gatewayReady(env)) return openai;
  return withFallback(openai, gateway(id) as LanguageModelV4, (error) => {
    const name = error instanceof Error ? error.name : "error";
    console.warn(`openai ${direct} failed (${name}); using the AI Gateway`);
  });
}
