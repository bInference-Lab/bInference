import { describe, expect, it } from "vitest";
import type { ModelRequest } from "../loop/turn-records.js";
import { chatPayloadOf } from "./chat-payload.js";

const request: ModelRequest = {
  prefix: "You are a trading agent.",
  messages: [
    { role: "owner", text: "Buy CAKE?" },
    {
      role: "agent",
      text: "",
      reasoning: "Check the token first.",
      toolCalls: [
        { id: "call_1", name: "token_info", argumentsText: '{"symbol":"CAKE"}' },
        { id: "call_2", name: "portfolio", argumentsText: "" },
      ],
    },
    { role: "tool", callId: "call_1", name: "token_info", text: "CAKE: $2.10", isError: false },
    { role: "tool", callId: "call_2", name: "portfolio", text: "No wallet.", isError: true },
  ],
  tools: [
    {
      name: "token_info",
      description: "Reads a token.",
      parameters: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  ],
};

describe("chatPayloadOf", () => {
  it("maps the conversation, the tools and the output limit into a streamed request", () => {
    expect(chatPayloadOf(request, { model: "gpt-5-mini" })).toStrictEqual({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: "You are a trading agent." },
        { role: "user", content: "Buy CAKE?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "token_info", arguments: '{"symbol":"CAKE"}' },
            },
            { id: "call_2", type: "function", function: { name: "portfolio", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "CAKE: $2.10" },
        { role: "tool", tool_call_id: "call_2", content: "No wallet." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "token_info",
            description: "Reads a token.",
            parameters: {
              type: "object",
              properties: { symbol: { type: "string" } },
              required: ["symbol"],
              additionalProperties: false,
            },
          },
        },
      ],
      max_completion_tokens: 4096,
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("sends no system message for no instructions and no tools for none", () => {
    const bare: ModelRequest = {
      prefix: "",
      messages: [{ role: "agent", text: "Hi.", reasoning: "", toolCalls: [] }],
      tools: [],
    };
    const payload = chatPayloadOf(bare, { model: "gpt-5-mini" });
    expect([payload.messages, "tools" in payload]).toStrictEqual([
      [{ role: "assistant", content: "Hi." }],
      false,
    ]);
  });

  it("marks the end of the prefix and of the history for a model of Anthropic's", () => {
    const payload = chatPayloadOf(request, { model: "anthropic/claude-sonnet-4.5" });
    const mark = { type: "ephemeral" };
    expect(payload.messages.map((message) => message.content)).toStrictEqual([
      [{ type: "text", text: "You are a trading agent.", cache_control: mark }],
      "Buy CAKE?",
      null,
      "CAKE: $2.10",
      [{ type: "text", text: "No wallet.", cache_control: mark }],
    ]);
  });

  it("sends the live facts as the last user message, after the history's mark and unmarked", () => {
    const facts = "Live facts from binference.";
    const payload = chatPayloadOf(
      { ...request, tail: facts },
      { model: "anthropic/claude-sonnet-4.5" },
    );
    expect(payload.messages.slice(-2)).toStrictEqual([
      {
        role: "tool",
        tool_call_id: "call_2",
        content: [{ type: "text", text: "No wallet.", cache_control: { type: "ephemeral" } }],
      },
      { role: "user", content: facts },
    ]);
    expect(payload.messages[0]).toStrictEqual({
      role: "system",
      content: [
        { type: "text", text: "You are a trading agent.", cache_control: { type: "ephemeral" } },
      ],
    });
  });

  it("marks the last message with text when the history ends with an empty one", () => {
    const ending: ModelRequest = {
      ...request,
      messages: [...request.messages, { role: "owner", text: "" }],
    };
    const payload = chatPayloadOf(ending, { model: "anthropic/claude-haiku-4.5" });
    expect(payload.messages.slice(-2).map((message) => message.content)).toStrictEqual([
      [{ type: "text", text: "No wallet.", cache_control: { type: "ephemeral" } }],
      "",
    ]);
  });

  it.each(["gpt-5-mini", "openai/gpt-5", "claude-sonnet-4-5", "google/gemini-2.5-pro"])(
    "places no cache mark for %s",
    (model) => {
      expect(JSON.stringify(chatPayloadOf(request, { model }))).not.toContain("cache_control");
    },
  );

  it("sends the owner's images as base64 data URLs before the text", () => {
    const payload = chatPayloadOf(
      {
        prefix: "",
        messages: [
          {
            role: "owner",
            text: "What does this chart show?",
            images: [
              { contentType: "image/png", data: "iVBORw0KGgo=" },
              { contentType: "image/webp", data: "UklGRg==" },
            ],
          },
          { role: "owner", text: "", images: [{ contentType: "image/jpeg", data: "/9j/4A==" }] },
        ],
        tools: [],
      },
      { model: "gpt-5-mini" },
    );
    expect(payload.messages).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
          { type: "image_url", image_url: { url: "data:image/webp;base64,UklGRg==" } },
          { type: "text", text: "What does this chart show?" },
        ],
      },
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/4A==" } }],
      },
    ]);
  });
});
