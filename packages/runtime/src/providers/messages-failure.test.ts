import type { Clock } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { ModelEvent } from "../loop/model-event.js";
import { createRecordedHttp, type RecordedAnswer } from "../testing/recorded-http.js";
import {
  messagesContextOverflow,
  messagesErrorAnswer,
} from "../testing/recorded-messages-streams.js";
import { createMessagesTransport } from "./messages-transport.js";
import type { StreamingHttp } from "./ports.js";

const nowMs = 1_760_000_000_000;
const clock: Clock = { now: () => nowMs, sleep: async () => Promise.resolve() };

async function lastEventOn(http: StreamingHttp): Promise<ModelEvent | undefined> {
  const transport = createMessagesTransport({
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-test",
    model: "claude-sonnet-5-5",
    timeoutMs: 120_000,
    http,
    clock,
  });
  const request = {
    instructions: "",
    messages: [{ role: "owner", text: "hi" } as const],
    tools: [],
  };
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

describe("the Messages failure classes", () => {
  it("classes a prompt over the context window as context, without the provider's words", async () => {
    await expect(lastEvent(messagesContextOverflow)).resolves.toStrictEqual({
      type: "error",
      failure: "context",
      message: "The model provider answered 400 (invalid_request_error).",
    });
  });

  it("classes an input and output over the context limit as context", async () => {
    const answer = messagesErrorAnswer(400, "invalid_request_error", {
      words: "input length and `max_tokens` exceed context limit: 197000 + 4096 > 200000",
    });
    await expect(lastEvent(answer)).resolves.toMatchObject({ failure: "context" });
  });

  it("classes a rate limit as transient, with the wait its retry-after asks for", async () => {
    const answer = messagesErrorAnswer(429, "rate_limit_error", {
      headers: { "retry-after": "17" },
    });
    await expect(lastEvent(answer)).resolves.toStrictEqual({
      type: "error",
      failure: "transient",
      message: "The model provider answered 429 (rate_limit_error).",
      retryAfterMs: 17_000,
    });
  });

  it.each([
    [401, "authentication_error", "auth"],
    [402, "billing_error", "billing"],
    [403, "permission_error", "auth"],
    [404, "not_found_error", "request"],
    [413, "request_too_large", "context"],
    [500, "api_error", "transient"],
    [504, "timeout_error", "transient"],
    [529, "overloaded_error", "transient"],
  ])("classes %i %s as %s", async (status, type, failure) => {
    await expect(lastEvent(messagesErrorAnswer(status, type))).resolves.toMatchObject({
      failure,
      message: `The model provider answered ${String(status)} (${type}).`,
    });
  });

  it("classes no answer at all as transient", async () => {
    await expect(lastEventOn(createRecordedHttp([]))).resolves.toStrictEqual({
      type: "error",
      failure: "transient",
      message: "No answer came from the model provider.",
    });
  });
});
