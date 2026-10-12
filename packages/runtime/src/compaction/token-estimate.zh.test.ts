import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../loop/model-message.js";
import { estimateRequestTokens, estimateTextTokens } from "./token-estimate.js";

// Provider counts written from OpenAI's documentation, never from a live call. The cookbook
// "How to count tokens with tiktoken" (developers.openai.com/cookbook) prints the tokens of the
// CJK string below in each encoding: 9 in cl100k_base and 8 in o200k_base. Its message rules count
// 3 tokens for each message, the role's own tokens (1 for "user" and for "assistant"), and 3 that
// open the reply.
const documented = {
  text: "お誕生日おめでとう",
  tokens: { cl100k_base: 9, o200k_base: 8 },
  perMessage: 3,
  perRole: 1,
  perReply: 3,
} as const;

function within(estimate: number, reference: number, share: number): boolean {
  return Math.abs(estimate - reference) <= reference * share;
}

describe("estimateTextTokens in CJK", () => {
  it("counts each CJK character as one token beside other text at 4 characters a token", () => {
    expect(estimateTextTokens("买入一百个代币")).toBe(7);
    expect(estimateTextTokens("买入 BNB")).toBe(3);
  });

  it("counts full-width punctuation, kana and Hangul as CJK", () => {
    expect(estimateTextTokens("好，。")).toBe(3);
    expect(estimateTextTokens("カナ한국")).toBe(4);
  });

  it("counts an ideograph outside the basic plane once", () => {
    expect(estimateTextTokens("𠀀")).toBe(1);
  });

  it.each(Object.entries(documented.tokens))(
    "stays within 15%% of the documented %s count of a CJK text",
    (_encoding, reference) => {
      expect(within(estimateTextTokens(documented.text), reference, 0.15)).toBe(true);
    },
  );
});

describe("estimateRequestTokens in CJK", () => {
  // Six messages of the documented text, the owner's and the agent's in turn.
  const transcript: readonly ModelMessage[] = Array.from({ length: 6 }, (_, index) =>
    index % 2 === 0
      ? { role: "owner", text: documented.text }
      : { role: "agent", text: documented.text, reasoning: "", toolCalls: [] },
  );

  it.each(Object.entries(documented.tokens))(
    "stays within 15%% of a CJK transcript's count under the documented %s rules",
    (_encoding, perText) => {
      const reference =
        transcript.length * (documented.perMessage + documented.perRole + perText) +
        documented.perReply;
      const estimate = estimateRequestTokens({ prefix: "", messages: transcript, tools: [] });
      expect(within(estimate, reference, 0.15)).toBe(true);
    },
  );
});
