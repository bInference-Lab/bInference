import type { Clock } from "@binference/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelTransportContract } from "../contracts/model-transport-contract.js";
import type { ModelEvent } from "../loop/model-event.js";
import type { ModelRequest } from "../loop/turn-records.js";
import { createRecordedHttp, type RecordedAnswer } from "../testing/recorded-http.js";
import {
  messagesCutStream,
  messagesMaxTokensStream,
  messagesOverloadedMidStream,
  messagesRefusalStream,
  messagesTextStream,
  messagesThinkingStream,
  messagesToolUseStream,
  messagesWholeInputStream,
  messagesWindowFullStream,
} from "../testing/recorded-messages-streams.js";
import { createMessagesTransport } from "./messages-transport.js";

const clock: Clock = { now: () => 1_760_000_000_000, sleep: async () => Promise.resolve() };
const baseUrl = "https://models.example.test";
const withKey = { apiKey: "sk-ant-test" };

const request: ModelRequest = {
  instructions: "You are a trading agent.",
  messages: [{ role: "owner", text: "How is BNB doing?" }],
  tools: [],
};

function transportOn(answers: readonly RecordedAnswer[], key: { apiKey?: string } = withKey) {
  const http = createRecordedHttp(answers);
  const transport = createMessagesTransport({
    baseUrl,
    ...key,
    model: "claude-sonnet-5-5",
    timeoutMs: 120_000,
    http,
    clock,
  });
  return { http, transport };
}

async function eventsOf(
  answers: readonly RecordedAnswer[],
  signal = new AbortController().signal,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of transportOn(answers).transport.stream(request, signal)) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createMessagesTransport", () => {
  it.each(
    modelTransportContract({
      create: async () => transportOn([messagesTextStream]).transport,
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reduces a text answer into its text, stop and usage with the cached input", async () => {
    await expect(eventsOf([messagesTextStream])).resolves.toStrictEqual([
      { type: "text", delta: "BNB is" },
      { type: "text", delta: " up 2% today." },
      {
        type: "done",
        stop: "end",
        usage: { inputTokens: 812, outputTokens: 9, cachedTokens: 800, cacheWriteTokens: 0 },
      },
    ]);
  });

  it("reduces tool use into each call's start, input pieces and end", async () => {
    await expect(eventsOf([messagesToolUseStream])).resolves.toStrictEqual([
      { type: "text", delta: "Let me check." },
      { type: "toolCallStart", index: 1, id: "toolu_01A", name: "token_info" },
      { type: "toolCallDelta", index: 1, delta: '{"sym' },
      { type: "toolCallDelta", index: 1, delta: 'bol":"CAKE"}' },
      { type: "toolCallEnd", index: 1 },
      { type: "toolCallStart", index: 2, id: "toolu_01B", name: "portfolio" },
      { type: "toolCallEnd", index: 2 },
      {
        type: "done",
        stop: "tool_calls",
        usage: { inputTokens: 3248, outputTokens: 41, cachedTokens: 0, cacheWriteTokens: 2048 },
      },
    ]);
  });

  it("keeps a thinking answer's blocks with their signatures as its replay", async () => {
    const events = await eventsOf([messagesThinkingStream]);
    expect(events).toStrictEqual([
      { type: "reasoning", delta: "The owner asks for a quote." },
      { type: "toolCallStart", index: 1, id: "toolu_03A", name: "quote" },
      { type: "toolCallDelta", index: 1, delta: '{"amount":"1"}' },
      { type: "toolCallEnd", index: 1 },
      {
        type: "done",
        stop: "tool_calls",
        usage: { inputTokens: 300, outputTokens: 120, cachedTokens: 0, cacheWriteTokens: 0 },
        replay: {
          format: "messages",
          content: [
            {
              type: "thinking",
              thinking: "The owner asks for a quote.",
              signature: "EqQBCgIYAhIM1gbcDa9GJwZA",
            },
            { type: "tool_use", id: "toolu_03A", name: "quote", input: { amount: "1" } },
            { type: "redacted_thinking", data: "EmwKAhgBEgy3va3pzix" },
          ],
        },
      },
    ]);
  });

  it("takes a call's whole input from its start when no piece follows", async () => {
    await expect(eventsOf([messagesWholeInputStream])).resolves.toStrictEqual([
      { type: "toolCallStart", index: 0, id: "toolu_09A", name: "token_info" },
      { type: "toolCallDelta", index: 0, delta: '{"symbol":"CAKE"}' },
      { type: "toolCallEnd", index: 0 },
      {
        type: "done",
        stop: "tool_calls",
        usage: { inputTokens: 20, outputTokens: 12, cachedTokens: 0, cacheWriteTokens: 0 },
      },
    ]);
  });

  it("reads the same events whatever the byte boundaries of the stream", async () => {
    const whole = messagesThinkingStream.chunks.join("");
    const pieces = Array.from({ length: Math.ceil(whole.length / 7) }, (_, index) =>
      whole.slice(index * 7, index * 7 + 7),
    );
    await expect(eventsOf([{ ...messagesThinkingStream, chunks: pieces }])).resolves.toStrictEqual(
      await eventsOf([messagesThinkingStream]),
    );
  });

  it.each([
    ["its output limit", messagesMaxTokensStream],
    ["the model's context window", messagesWindowFullStream],
  ])("ends an answer %s cut with the length stop", async (_case, answer) => {
    const events = await eventsOf([answer]);
    expect(events.at(-1)).toMatchObject({ type: "done", stop: "length" });
  });

  it("ends an answer the safety classifiers stopped as refused, naming the category", async () => {
    await expect(eventsOf([messagesRefusalStream])).resolves.toStrictEqual([
      { type: "text", delta: "I can" },
      {
        type: "error",
        failure: "refused",
        message: "The provider stopped the answer for its safety rules (cyber).",
        // A refused answer was billed, so its usage goes with the failure.
        usage: { inputTokens: 40, outputTokens: 3, cachedTokens: 0, cacheWriteTokens: 0 },
      },
    ]);
  });

  it("ends a stream with an overloaded error event as transient, naming only its type", async () => {
    await expect(eventsOf([messagesOverloadedMidStream])).resolves.toStrictEqual([
      { type: "text", delta: "Checking" },
      {
        type: "error",
        failure: "transient",
        message: "The model provider ended the stream with an error (overloaded_error).",
      },
    ]);
  });

  it("ends a stream cut before its stop reason as transient", async () => {
    const events = await eventsOf([messagesCutStream]);
    expect(events.at(-1)).toMatchObject({ type: "error", failure: "transient" });
  });

  it("ends a stream that stalls as aborted when the call is stopped", async () => {
    const stop = new AbortController();
    const { transport } = transportOn([{ ...messagesCutStream, hang: true }]);
    const events: ModelEvent[] = [];
    for await (const event of transport.stream(request, stop.signal)) {
      events.push(event);
      stop.abort();
    }
    expect(events).toStrictEqual([
      { type: "text", delta: "The price" },
      { type: "error", failure: "aborted", message: "The model call was stopped." },
    ]);
  });

  it("sends the call to its own base URL with its own key whatever ANTHROPIC_* says", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://stray.example.test");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-stray");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "stray-token");
    vi.stubEnv("ANTHROPIC_LOG", "debug");
    vi.stubEnv("ANTHROPIC_WEBHOOK_SIGNING_KEY", "whsec_stray");
    vi.stubEnv(
      "ANTHROPIC_CUSTOM_HEADERS",
      "x-api-key: sk-ant-stray\nanthropic-version: 2099-01-01\nanthropic-beta: stray-beta",
    );
    const said = vi.spyOn(console, "debug");
    const { http, transport } = transportOn([messagesTextStream]);
    for await (const event of transport.stream(request, new AbortController().signal)) {
      expect(event.type).not.toBe("error");
    }
    expect(
      http.requests.map(({ url, method, headers }) => ({ url, method, headers })),
    ).toStrictEqual([
      {
        url: `${baseUrl}/v1/messages`,
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": "sk-ant-test",
        },
      },
    ]);
    expect(said).not.toHaveBeenCalled();
  });

  it("calls a provider without a key with no key, never one from a profile or a federation", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-stray");
    vi.stubEnv("ANTHROPIC_PROFILE", "stray");
    vi.stubEnv("ANTHROPIC_CONFIG_DIR", "/nonexistent/anthropic");
    vi.stubEnv("ANTHROPIC_FEDERATION_RULE_ID", "fdrl_stray");
    vi.stubEnv("ANTHROPIC_ORGANIZATION_ID", "org_stray");
    vi.stubEnv("ANTHROPIC_SERVICE_ACCOUNT_ID", "svac_stray");
    vi.stubEnv("ANTHROPIC_IDENTITY_TOKEN", "stray.jwt.token");
    vi.stubEnv("ANTHROPIC_WORKSPACE_ID", "wrkspc_stray");
    const { http, transport } = transportOn([messagesTextStream], {});
    for await (const event of transport.stream(request, new AbortController().signal)) {
      expect(event.type).not.toBe("error");
    }
    expect(http.requests.map(({ url, headers }) => ({ url, headers }))).toStrictEqual([
      {
        url: `${baseUrl}/v1/messages`,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
      },
    ]);
  });
});
