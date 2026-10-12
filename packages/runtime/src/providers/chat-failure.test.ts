import type { Clock } from "@binference/core";
import { describe, expect, it, vi } from "vitest";
import type { ModelEvent, ModelFailure } from "../loop/model-event.js";
import type { ModelRequest } from "../loop/turn-records.js";
import {
  contextOverflow,
  errorAnswer,
  gatewayContextOverflow,
} from "../testing/recorded-chat-streams.js";
import { createRecordedHttp, type RecordedAnswer } from "../testing/recorded-http.js";
import { createChatCompletionsTransport } from "./chat-completions-transport.js";
import type { StreamingHttp } from "./ports.js";

const nowMs = 1_760_000_000_000;
const clock: Clock = { now: () => nowMs, sleep: async () => Promise.resolve() };

const request: ModelRequest = {
  instructions: "",
  messages: [{ role: "owner", text: "hi" }],
  tools: [],
};

async function lastEventOn(
  http: StreamingHttp,
  timeoutMs = 120_000,
): Promise<ModelEvent | undefined> {
  const transport = createChatCompletionsTransport({
    baseUrl: "https://models.example.test/v1",
    apiKey: "sk-test-key",
    model: "gpt-5-mini",
    timeoutMs,
    http,
    clock,
  });
  const events: ModelEvent[] = [];
  for await (const event of transport.stream(request, new AbortController().signal)) {
    events.push(event);
  }
  expect(events.filter((event) => event.type === "error" || event.type === "done")).toHaveLength(1);
  return events.at(-1);
}

async function lastEvent(answer: RecordedAnswer): Promise<ModelEvent | undefined> {
  return lastEventOn(createRecordedHttp([answer]));
}

describe("the Chat Completions failure classes", () => {
  it("classes a request over the context window by OpenAI's documented code", async () => {
    await expect(lastEvent(contextOverflow)).resolves.toStrictEqual({
      type: "error",
      failure: "context",
      message: "The model provider answered 400 (context_length_exceeded).",
    });
  });

  it("classes a gateway's context overflow that has only words as context", async () => {
    await expect(lastEvent(gatewayContextOverflow)).resolves.toMatchObject({
      failure: "context",
      message: "The model provider answered 400 (400).",
    });
  });

  it.each<readonly [number, string, ModelFailure]>([
    [400, "invalid_request_error", "request"],
    [400, "content_policy_violation", "refused"],
    [401, "invalid_api_key", "auth"],
    [403, "unsupported_country_region_territory", "auth"],
    [402, "insufficient_balance", "billing"],
    [402, "key_limit", "billing"],
    [404, "model_not_found", "request"],
    [408, "timeout", "transient"],
    [413, "request_too_large", "context"],
    [422, "unprocessable_entity", "request"],
    [429, "insufficient_quota", "billing"],
    [429, "rate_limit_exceeded", "transient"],
    [500, "server_error", "transient"],
    [502, "bad_gateway", "transient"],
    [503, "overloaded", "transient"],
    [504, "gateway_timeout", "transient"],
    [529, "overloaded_error", "transient"],
  ])("classes %i with code %s as %s", async (status, code, failure) => {
    await expect(lastEvent(errorAnswer(status, code))).resolves.toStrictEqual({
      type: "error",
      failure,
      message: `The model provider answered ${String(status)} (${code}).`,
    });
  });

  it.each([
    [{ "retry-after-ms": "1500" }, 1_500],
    [{ "retry-after": "7" }, 7_000],
    [{ "retry-after": new Date(nowMs + 30_000).toUTCString() }, 30_000],
    [{ "retry-after-ms": "250.5", "retry-after": "9" }, 251],
  ])("reads how long to wait from %o", async (headers, retryAfterMs) => {
    const answer = errorAnswer(429, "rate_limit_exceeded", headers);
    await expect(lastEvent(answer)).resolves.toMatchObject({ failure: "transient", retryAfterMs });
  });

  it("gives no wait for a failure that is not transient", async () => {
    const answer = errorAnswer(401, "invalid_api_key", { "retry-after": "7" });
    await expect(lastEvent(answer)).resolves.not.toHaveProperty("retryAfterMs");
  });

  it("names no code the provider wrote in a shape it cannot be", async () => {
    await expect(lastEvent(errorAnswer(400, "a code with spaces"))).resolves.toMatchObject({
      message: "The model provider answered 400.",
    });
  });

  it("classes a request that got no answer as transient", async () => {
    await expect(lastEventOn(createRecordedHttp([]))).resolves.toStrictEqual({
      type: "error",
      failure: "transient",
      message: "No answer came from the model provider.",
    });
  });

  it("classes a provider that does not start its answer in time as transient", async () => {
    const silent: StreamingHttp = {
      open: async ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    };
    const last = lastEventOn(silent, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(last).resolves.toStrictEqual({
      type: "error",
      failure: "transient",
      message: "The model provider did not answer in time.",
    });
  });

  it("classes a chunk that is not JSON as transient", async () => {
    const answer = { status: 200, headers: {}, chunks: ["data: {not json\n\n"] };
    await expect(lastEvent(answer)).resolves.toMatchObject({ failure: "transient" });
  });

  it("classes a chunk of the wrong shape as transient", async () => {
    const answer = { status: 200, headers: {}, chunks: ['data: {"choices":"none"}\n\n'] };
    await expect(lastEvent(answer)).resolves.toStrictEqual({
      type: "error",
      failure: "transient",
      message: "The model provider sent a malformed stream: a chunk.",
    });
  });

  it("classes a tool call that starts without a name as transient", async () => {
    const piece = '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1"}]}}]}';
    const answer = { status: 200, headers: {}, chunks: [`data: ${piece}\n\n`] };
    await expect(lastEvent(answer)).resolves.toStrictEqual({
      type: "error",
      failure: "transient",
      message: "The model provider sent a malformed stream: a tool call began without a name.",
    });
  });
});
