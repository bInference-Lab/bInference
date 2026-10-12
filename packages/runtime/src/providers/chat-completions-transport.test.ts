import type { Clock } from "@binference/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelTransportContract } from "../contracts/model-transport-contract.js";
import type { ModelEvent } from "../loop/model-event.js";
import type { ModelRequest } from "../loop/turn-records.js";
import {
  contentFilterStream,
  cutStream,
  gatewayStream,
  lengthStream,
  midStreamErrorStream,
  textStream,
  toolCallsStream,
} from "../testing/recorded-chat-streams.js";
import { createRecordedHttp, type RecordedAnswer } from "../testing/recorded-http.js";
import { createChatCompletionsTransport } from "./chat-completions-transport.js";

const clock: Clock = { now: () => 1_760_000_000_000, sleep: async () => Promise.resolve() };
const baseUrl = "https://models.example.test/v1";

const request: ModelRequest = {
  prefix: "You are a trading agent.",
  messages: [{ role: "owner", text: "How is BNB doing?" }],
  tools: [],
};

function transportOn(answers: readonly RecordedAnswer[], model = "gpt-5-mini") {
  const http = createRecordedHttp(answers);
  const transport = createChatCompletionsTransport({
    baseUrl,
    apiKey: "sk-test-key",
    model,
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
});

describe("createChatCompletionsTransport", () => {
  it.each(
    modelTransportContract({
      create: async () => transportOn([textStream]).transport,
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reduces a text answer into its text, stop and usage", async () => {
    await expect(eventsOf([textStream])).resolves.toStrictEqual([
      { type: "text", delta: "BNB is" },
      { type: "text", delta: " up 2% today." },
      {
        type: "done",
        stop: "end",
        usage: { inputTokens: 812, outputTokens: 9, cachedTokens: 768 },
      },
    ]);
  });

  it("reduces tool calls into their starts, argument pieces and ends", async () => {
    await expect(eventsOf([toolCallsStream])).resolves.toStrictEqual([
      { type: "text", delta: "Let me check." },
      { type: "toolCallStart", index: 0, id: "call_Qx1", name: "token_info" },
      { type: "toolCallDelta", index: 0, delta: '{"sym' },
      { type: "toolCallDelta", index: 0, delta: 'bol":"CAKE"}' },
      { type: "toolCallStart", index: 1, id: "call_Qx2", name: "portfolio" },
      { type: "toolCallDelta", index: 1, delta: "{}" },
      { type: "toolCallEnd", index: 0 },
      { type: "toolCallEnd", index: 1 },
      {
        type: "done",
        stop: "tool_calls",
        usage: { inputTokens: 1200, outputTokens: 41, cachedTokens: 0 },
      },
    ]);
  });

  it("reads a gateway's reasoning and its cost in micro-dollars, rounded up", async () => {
    await expect(eventsOf([gatewayStream])).resolves.toStrictEqual([
      { type: "reasoning", delta: "The owner asks for the price." },
      { type: "text", delta: "About $612." },
      {
        type: "done",
        stop: "end",
        usage: { inputTokens: 5321, outputTokens: 24, cachedTokens: 4096, usdMicros: 2457n },
      },
    ]);
  });

  it("reads the same events whatever the byte boundaries of the stream", async () => {
    const whole = toolCallsStream.chunks.join("");
    const pieces = Array.from({ length: Math.ceil(whole.length / 7) }, (_, index) =>
      whole.slice(index * 7, index * 7 + 7),
    );
    await expect(eventsOf([{ ...toolCallsStream, chunks: pieces }])).resolves.toStrictEqual(
      await eventsOf([toolCallsStream]),
    );
  });

  it("ends an answer its output limit cut with the length stop", async () => {
    const events = await eventsOf([lengthStream]);
    expect(events.at(-1)).toStrictEqual({
      type: "done",
      stop: "length",
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
    });
  });

  it("ends an answer the content filter stopped as refused, keeping its text", async () => {
    await expect(eventsOf([contentFilterStream])).resolves.toStrictEqual([
      { type: "text", delta: "I can" },
      {
        type: "error",
        failure: "refused",
        message: "The provider's content filter stopped the answer.",
      },
    ]);
  });

  it("ends a stream with an error event as transient, naming only its code", async () => {
    await expect(eventsOf([midStreamErrorStream])).resolves.toStrictEqual([
      { type: "text", delta: "Checking" },
      {
        type: "error",
        failure: "transient",
        message: "The model provider ended the stream with an error (server_error).",
      },
    ]);
  });

  it("ends a stream cut before its stop reason as transient", async () => {
    const events = await eventsOf([cutStream]);
    expect(events.at(-1)).toMatchObject({ type: "error", failure: "transient" });
  });

  it("ends a stream that stalls as aborted when the call is stopped", async () => {
    const stop = new AbortController();
    const { transport } = transportOn([{ ...cutStream, hang: true }]);
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

  it("sends the call to its own base URL whatever OPENAI_* variables are set", async () => {
    vi.stubEnv("OPENAI_BASE_URL", "https://stray.example.test/v1");
    vi.stubEnv("OPENAI_API_KEY", "sk-stray");
    vi.stubEnv("OPENAI_ADMIN_KEY", "sk-admin-stray");
    vi.stubEnv("OPENAI_ORG_ID", "org-stray");
    vi.stubEnv("OPENAI_PROJECT_ID", "proj_stray");
    vi.stubEnv("OPENAI_WEBHOOK_SECRET", "whsec_stray");
    vi.stubEnv("OPENAI_LOG", "debug");
    vi.stubEnv(
      "OPENAI_CUSTOM_HEADERS",
      "x-stray: 1\nOpenAI-Organization: org-stray\nAuthorization: Bearer sk-stray",
    );
    const { http, transport } = transportOn([textStream]);
    for await (const event of transport.stream(request, new AbortController().signal)) {
      expect(event.type).not.toBe("error");
    }
    expect(
      http.requests.map(({ url, method, headers }) => ({ url, method, headers })),
    ).toStrictEqual([
      {
        url: `${baseUrl}/chat/completions`,
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: "Bearer sk-test-key",
        },
      },
    ]);
  });
});
