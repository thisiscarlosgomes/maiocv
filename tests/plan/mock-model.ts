import { MockLanguageModelV4 } from "ai/test";
import type { ToolStep } from "./fixtures.ts";

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } };

/** Replays a scripted sequence of tool calls, then a text reply. Records every call for assertions. */
export function scriptedModel(script: ToolStep[], reply: string) {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const calls = script[step];
      step += 1;
      if (calls) return {
        content: calls.map((c, i) => ({ type: "tool-call" as const, toolCallId: `call-${step}-${i}`, toolName: c.tool, input: JSON.stringify(c.input) })),
        finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [],
      };
      return { content: [{ type: "text" as const, text: reply }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  });
}
