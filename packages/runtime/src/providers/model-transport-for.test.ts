import type { Clock } from "@binference/core";
import { describe, expect, it } from "vitest";
import { modelTransportContract } from "../contracts/model-transport-contract.js";
import type { RuntimeModels, RuntimeProvider } from "../control/runtime-settings.schema.js";
import type { ModelEvent } from "../loop/model-event.js";
import { textStream } from "../testing/recorded-chat-streams.js";
import { createRecordedHttp, type RecordedAnswer } from "../testing/recorded-http.js";
import { messagesTextStream } from "../testing/recorded-messages-streams.js";
import { binferenceGatewayUrl, modelTransportFor } from "./model-transport-for.js";

const clock: Clock = { now: () => 0, sleep: async () => Promise.resolve() };

function modelsWith(
  providers: Readonly<Record<string, RuntimeProvider>>,
  main?: string,
): RuntimeModels {
  return {
    providers,
    ...(main === undefined ? {} : { main }),
    fallbacks: { main: [], fast: [] },
    idleTimeoutMs: 120_000,
    cooldownMs: 60_000,
    maxToolCallsPerTurn: 25,
    loopDetection: true,
    prices: {},
  };
}

async function eventsOf(models: RuntimeModels, answer: RecordedAnswer = textStream) {
  const http = createRecordedHttp([answer]);
  const transport = modelTransportFor(models, "main", { http, clock });
  const request = { instructions: "", messages: [], tools: [] };
  const events: ModelEvent[] = [];
  for await (const event of transport.stream(request, new AbortController().signal)) {
    events.push(event);
  }
  return { http, events };
}

describe("modelTransportFor", () => {
  it.each(
    modelTransportContract({
      create: async () =>
        modelTransportFor(
          modelsWith({ own: { kind: "openai", apiKey: "sk-test" } }, "own/gpt-5-mini"),
          "main",
          { http: createRecordedHttp([textStream]), clock },
        ),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("calls the binference gateway with the model id after the provider's name", async () => {
    const models = modelsWith(
      { binference: { kind: "binference", apiKey: "binf_test" } },
      "binference/anthropic/claude-sonnet-4.5",
    );
    const { http } = await eventsOf(models);
    expect(
      http.requests.map(({ url, body }) => [url, JSON.parse(String(body)) as unknown]),
    ).toMatchObject([
      [`${binferenceGatewayUrl}/chat/completions`, { model: "anthropic/claude-sonnet-4.5" }],
    ]);
  });

  it("calls OpenAI's API for the openai kind with no base URL, and a set base URL as given", async () => {
    const openai = await eventsOf(
      modelsWith({ oa: { kind: "openai", apiKey: "sk-test" } }, "oa/gpt-5-mini"),
    );
    const local = await eventsOf(
      modelsWith(
        { local: { kind: "openai", baseUrl: "http://127.0.0.1:11434/v1" } },
        "local/qwen3",
      ),
    );
    expect([openai.http.requests[0]?.url, local.http.requests[0]?.url]).toStrictEqual([
      "https://api.openai.com/v1/chat/completions",
      "http://127.0.0.1:11434/v1/chat/completions",
    ]);
    expect(local.http.requests[0]?.headers).not.toHaveProperty("authorization");
  });

  it("calls Anthropic's Messages API for the anthropic kind with its key and version", async () => {
    const { http, events } = await eventsOf(
      modelsWith({ an: { kind: "anthropic", apiKey: "sk-ant-test" } }, "an/claude-sonnet-5-5"),
      messagesTextStream,
    );
    expect(events.at(-1)).toMatchObject({ type: "done", stop: "end" });
    expect(
      http.requests.map(({ url, headers, body }) => ({
        url,
        headers,
        model: (JSON.parse(String(body)) as { model: string }).model,
      })),
    ).toStrictEqual([
      {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": "sk-ant-test",
        },
        model: "claude-sonnet-5-5",
      },
    ]);
  });

  it.each([
    ["no main model", modelsWith({}), "No main model is set as <provider>/<model> in models.main."],
    [
      "a model with no provider name",
      modelsWith({}, "gpt-5"),
      "No main model is set as <provider>/<model> in models.main.",
    ],
    [
      "an unknown provider",
      modelsWith({}, "own/gpt-5"),
      "The provider of models.main is not in models.providers.",
    ],
  ])("refuses every call for %s", async (_case, models, message) => {
    const { http, events } = await eventsOf(models);
    expect(events).toStrictEqual([{ type: "error", failure: "request", message }]);
    expect(http.requests).toHaveLength(0);
  });
});
