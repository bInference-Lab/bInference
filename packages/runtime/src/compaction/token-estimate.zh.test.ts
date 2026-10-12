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

// Counted locally on 2026-10-13 from OpenAI's published tokenizer files cl100k_base.tiktoken
// (sha256 223921b7…b2a7) and o200k_base.tiktoken (sha256 446a9538…1a2d), each matching the hash
// OpenAI's tokenizer library expects. No model or provider was called.
const counted = [
  { text: "帮我把 0.1 BNB 换成 USDT，滑点不超过 1%。", cl100k_base: 28, o200k_base: 22 },
  {
    text: "我想设一个止损：如果 CAKE 跌到 2 美元以下，就全部卖出。",
    cl100k_base: 30,
    o200k_base: 23,
  },
  { text: "这个代币的交易税是多少？请先查一下风险再告诉我。", cl100k_base: 28, o200k_base: 17 },
  { text: "过去24小时我花了多少模型费用？还剩多少预算？", cl100k_base: 23, o200k_base: 15 },
  {
    text: "请总结一下我今天的持仓和盈亏，并列出所有未成交的订单。",
    cl100k_base: 27,
    o200k_base: 20,
  },
] as const;

/** The estimate never falls more than 15% below the heavier encoding, and stays near it. */
function conservative(estimate: number, counts: readonly number[], over: number): boolean {
  const heavier = Math.max(...counts);
  return estimate >= heavier * 0.85 && estimate <= heavier * (1 + over);
}

describe("estimateTextTokens in CJK", () => {
  it("counts each Han ideograph above one token, rounded up over the text", () => {
    expect(estimateTextTokens("买入一百个代币")).toBe(9);
    expect(estimateTextTokens("买入一百个代币买入一百个代币买入一百个代币")).toBe(25);
  });

  it("counts each number, word and symbol run between CJK characters", () => {
    expect(estimateTextTokens("买入 BNB")).toBe(4);
    expect(estimateTextTokens("滑点 1%")).toBe(6);
  });

  it("counts full-width punctuation, kana and Hangul as one token each", () => {
    expect(estimateTextTokens("，。？")).toBe(3);
    expect(estimateTextTokens("カナ한국")).toBe(4);
    expect(estimateTextTokens("おめでとう")).toBe(5);
  });

  it("counts an ideograph outside the basic plane as Han", () => {
    expect(estimateTextTokens("𠀀")).toBe(2);
  });

  it.each(counted)("stays within 15%% below the heavier counted encoding of $text", (line) => {
    const estimate = estimateTextTokens(line.text);
    expect(conservative(estimate, [line.cl100k_base, line.o200k_base], 0.15)).toBe(true);
  });

  it("stays within 5% of the heavier encoding over all counted lines", () => {
    const estimate = counted.reduce((sum, line) => sum + estimateTextTokens(line.text), 0);
    const cl100k = counted.reduce((sum, line) => sum + line.cl100k_base, 0);
    const o200k = counted.reduce((sum, line) => sum + line.o200k_base, 0);
    expect([cl100k, o200k]).toStrictEqual([136, 97]);
    expect(Math.abs(estimate - cl100k)).toBeLessThanOrEqual(cl100k * 0.05);
  });

  it("stays within 15%% below the documented counts of a Japanese text", () => {
    const estimate = estimateTextTokens(documented.text);
    const counts = Object.values(documented.tokens);
    expect(conservative(estimate, counts, 0.15)).toBe(true);
  });
});

describe("estimateRequestTokens in CJK", () => {
  // Six messages of the documented text, the owner's and the agent's in turn.
  const transcript: readonly ModelMessage[] = Array.from({ length: 6 }, (_, index) =>
    index % 2 === 0
      ? { role: "owner", text: documented.text }
      : { role: "agent", text: documented.text, reasoning: "", toolCalls: [] },
  );

  it("stays within 15% below a CJK transcript's count under the documented rules", () => {
    const references = Object.values(documented.tokens).map(
      (perText) =>
        transcript.length * (documented.perMessage + documented.perRole + perText) +
        documented.perReply,
    );
    const estimate = estimateRequestTokens({ prefix: "", messages: transcript, tools: [] });
    expect(conservative(estimate, references, 0.15)).toBe(true);
  });
});
