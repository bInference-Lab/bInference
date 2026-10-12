import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../loop/model-message.js";
import {
  estimateMessageTokens,
  estimateRequestTokens,
  estimateTextTokens,
} from "./token-estimate.js";

describe("estimateTextTokens", () => {
  it("counts text other than CJK as one token per 4 characters, rounded up", () => {
    expect(estimateTextTokens("buy 100 tokens")).toBe(4);
    expect(estimateTextTokens("tiktoken is great!")).toBe(5);
    expect(estimateTextTokens("")).toBe(0);
  });

  it("counts one token per number, word or symbol run when those outnumber the characters", () => {
    expect(estimateTextTokens("buy")).toBe(1);
    expect(estimateTextTokens(" 0.1 BNB ")).toBe(6);
    expect(estimateTextTokens("1234567")).toBe(3);
    expect(estimateTextTokens('{"a":"1"}')).toBe(5);
  });
});

describe("estimateRequestTokens", () => {
  it("adds the prefix, the tools and the tail to the messages, 3 for the call", () => {
    const hello: ModelMessage = { role: "owner", text: "hello" };
    const messages = [hello];
    const bare = estimateRequestTokens({ prefix: "", messages, tools: [] });
    expect(bare).toBe(3 + estimateMessageTokens(hello));
    const full = estimateRequestTokens({
      prefix: "abcd",
      messages,
      tail: "abcd",
      tools: [{ name: "quote", description: "", parameters: {} }],
    });
    expect(full).toBeGreaterThan(bare + 1 + 4 + 1);
  });

  it("counts a message's overhead, a call's name and arguments, and a result's text", () => {
    expect(estimateMessageTokens({ role: "owner", text: "hello" })).toBe(4 + 2);
    const call: ModelMessage = {
      role: "agent",
      text: "",
      reasoning: "",
      toolCalls: [{ id: "c1", name: "quote", argumentsText: '{"a":"1"}' }],
    };
    expect(estimateMessageTokens(call)).toBe(4 + 2 + 5);
    const result: ModelMessage = {
      role: "tool",
      callId: "c1",
      name: "quote",
      text: "1 BNB",
      isError: false,
    };
    expect(estimateMessageTokens(result)).toBe(4 + 2 + 2);
  });
});
