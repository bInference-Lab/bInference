import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../loop/model-message.js";
import type { ModelRequest } from "../loop/turn-records.js";
import { messagesPayloadOf } from "./messages-payload.js";

const mark = { type: "ephemeral" };
const quote = {
  name: "quote",
  description: "Quotes a swap.",
  parameters: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { amount: { type: "string" } },
    required: ["amount"],
  },
};
const portfolio = { name: "portfolio", description: "Reads the wallets.", parameters: {} };

function payloadOf(messages: readonly ModelMessage[], extra: Partial<ModelRequest> = {}) {
  return messagesPayloadOf(
    { instructions: "You are a trading agent.", messages, tools: [], ...extra },
    { model: "claude-sonnet-5-5" },
  );
}

const agent = (
  text: string,
  calls: readonly { id: string; name: string; argumentsText: string }[] = [],
): Extract<ModelMessage, { role: "agent" }> => ({
  role: "agent",
  text,
  reasoning: "",
  toolCalls: calls,
});

const result = (callId: string, text: string, isError = false): ModelMessage => ({
  role: "tool",
  callId,
  name: "quote",
  text,
  isError,
});

describe("messagesPayloadOf", () => {
  it("marks the stable system block, the last tool and the end of the history", () => {
    const payload = payloadOf([{ role: "owner", text: "price?" }], { tools: [quote, portfolio] });
    expect(payload).toStrictEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 4096,
      system: [{ type: "text", text: "You are a trading agent.", cache_control: mark }],
      tools: [
        {
          name: "quote",
          description: "Quotes a swap.",
          input_schema: {
            type: "object",
            properties: { amount: { type: "string" } },
            required: ["amount"],
          },
        },
        {
          name: "portfolio",
          description: "Reads the wallets.",
          input_schema: { type: "object" },
          cache_control: mark,
        },
      ],
      messages: [
        { role: "user", content: [{ type: "text", text: "price?", cache_control: mark }] },
      ],
      stream: true,
    });
  });

  it("sends no system and no tools when there are none", () => {
    const payload = payloadOf([{ role: "owner", text: "hi" }], { instructions: "" });
    expect(Object.keys(payload).toSorted()).toStrictEqual([
      "max_tokens",
      "messages",
      "model",
      "stream",
    ]);
  });

  it("sends calls as tool use, and their results with held messages as one user message", () => {
    const payload = payloadOf([
      { role: "owner", text: "buy" },
      agent("Quoting.", [
        { id: "toolu_1", name: "quote", argumentsText: '{"amount":"1"}' },
        { id: "toolu_2", name: "quote", argumentsText: "[1]" },
      ]),
      result("toolu_1", "1 BNB"),
      result("toolu_2", "", true),
      { role: "owner", text: "and sell" },
    ]);
    expect(payload.messages).toStrictEqual([
      { role: "user", content: [{ type: "text", text: "buy" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Quoting." },
          { type: "tool_use", id: "toolu_1", name: "quote", input: { amount: "1" } },
          { type: "tool_use", id: "toolu_2", name: "quote", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "1 BNB" },
          { type: "tool_result", tool_use_id: "toolu_2", is_error: true },
          { type: "text", text: "and sell", cache_control: mark },
        ],
      },
    ]);
  });

  it("sends a kept replay back exactly, thinking signatures and all", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "c2ln" },
      { type: "tool_use", id: "toolu_1", name: "quote", input: { amount: "1" } },
    ];
    const payload = payloadOf([
      { role: "owner", text: "buy" },
      {
        ...agent("", [{ id: "toolu_1", name: "quote", argumentsText: '{"amount":"1"}' }]),
        replay: { format: "messages", content },
      },
      result("toolu_1", "1 BNB"),
    ]);
    expect(payload.messages[1]).toStrictEqual({ role: "assistant", content });
  });

  it("writes a response again from its text and calls when its replay is not one it reads", () => {
    const payload = payloadOf([
      { role: "owner", text: "hi" },
      { ...agent("Hello."), replay: { format: "messages", content: [{ type: "image" }] } },
      { role: "owner", text: "again" },
    ]);
    expect(payload.messages[1]).toStrictEqual({
      role: "assistant",
      content: [{ type: "text", text: "Hello." }],
    });
  });

  it("leaves out empty texts and a response with nothing to send", () => {
    const payload = payloadOf([
      { role: "owner", text: "hi" },
      agent(""),
      { role: "owner", text: "" },
      { role: "owner", text: "there?" },
    ]);
    expect(payload.messages).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "text", text: "there?", cache_control: mark },
        ],
      },
    ]);
  });
});
