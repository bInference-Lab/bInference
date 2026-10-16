import type { Clock } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { modelChainContract } from "../contracts/model-chain-contract.js";
import { modelTransportContract } from "../contracts/model-transport-contract.js";
import type { RuntimeModels, RuntimeProvider } from "../control/runtime-settings.schema.js";
import type { ModelEvent } from "../loop/model-event.js";
import type { ModelTransport } from "../loop/ports.js";
import { textStream } from "../testing/recorded-chat-streams.js";
import { createRecordedHttp, type RecordedAnswer } from "../testing/recorded-http.js";
import { messagesTextStream } from "../testing/recorded-messages-streams.js";
import { binferenceGatewayUrl, modelChainFor } from "./model-transport-for.js";
import type { StreamingHttp } from "./ports.js";

const clock: Clock = { now: () => 0, sleep: async () => Promise.resolve() };

function firstTransportOf(models: RuntimeModels, http: StreamingHttp) {
  const [first] = modelChainFor(models, { role: "main" }, { http, clock, rests: new Map() }).models;
  if (first === undefined) {
    throw new Error("A chain holds at least one model.");
  }
  return first.transport;
}

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
    imageInput: [],
    prices: {},
  };
}

async function eventsOf(models: RuntimeModels, answer: RecordedAnswer = textStream) {
  const http = createRecordedHttp([answer]);
  const transport = firstTransportOf(models, http);
  const request = { prefix: "", messages: [], tools: [] };
  const events: ModelEvent[] = [];
  for await (const event of transport.stream(request, new AbortController().signal)) {
    events.push(event);
  }
  return { http, events };
}

async function eventsOfTransport(transport: ModelTransport | undefined): Promise<ModelEvent[]> {
  if (transport === undefined) {
    throw new Error("The chain has no such model.");
  }
  const events: ModelEvent[] = [];
  const request = { prefix: "", messages: [], tools: [] };
  for await (const event of transport.stream(request, new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

describe("modelChainFor", () => {
  it.each(
    modelTransportContract({
      create: async () =>
        firstTransportOf(
          modelsWith({ own: { kind: "openai", apiKey: "sk-test" } }, "own/gpt-5-mini"),
          createRecordedHttp([textStream]),
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

  it.each(
    modelChainContract({
      create: async () => {
        const manual = createManualClock(5_000);
        const models = modelsWith({ own: { kind: "openai" } }, "own/a");
        const http = createRecordedHttp([]);
        const chain = modelChainFor(
          models,
          { role: "main" },
          { http, clock: manual, rests: new Map() },
        );
        return { chain, cooldownMs: models.cooldownMs, advance: manual.advance };
      },
    }),
  )("keeps the chain contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("chains the role's model, then its fallbacks in order", () => {
    const models = {
      ...modelsWith({ a: { kind: "openai" }, b: { kind: "anthropic" } }, "a/one"),
      fallbacks: { main: ["b/two", "a/three"], fast: [] },
    };
    const chain = modelChainFor(
      models,
      { role: "main" },
      {
        http: createRecordedHttp([]),
        clock,
        rests: new Map(),
      },
    );
    expect(chain.models.map((model) => model.name)).toStrictEqual(["a/one", "b/two", "a/three"]);
  });

  it("chains only the model the owner picked, whatever the fallbacks", () => {
    const models = {
      ...modelsWith({ a: { kind: "openai" } }, "a/one"),
      fallbacks: { main: ["a/two"], fast: [] },
    };
    const parts = { http: createRecordedHttp([]), clock, rests: new Map<string, number>() };
    const chain = modelChainFor(models, { role: "main", picked: "a/picked" }, parts);
    expect(chain.models.map((model) => model.name)).toStrictEqual(["a/picked"]);
  });

  it("rests every model of a provider together, in the rests the runtime's turns share", async () => {
    const manual = createManualClock(5_000);
    const models = {
      ...modelsWith({ a: { kind: "openai" }, b: { kind: "openai" } }, "a/one"),
      fallbacks: { main: ["a/two", "b/three"], fast: [] },
    };
    const parts = { http: createRecordedHttp([]), clock: manual, rests: new Map<string, number>() };
    modelChainFor(models, { role: "main" }, parts).rest("a/one", 0);
    const next = modelChainFor(models, { role: "main" }, parts);
    expect(next.models.map((model) => next.resting(model.name))).toStrictEqual([true, true, false]);
  });

  it("refuses every call of a fallback whose provider is not configured, naming where", async () => {
    const models = {
      ...modelsWith({ a: { kind: "openai" } }, "a/one"),
      fallbacks: { main: ["gone/two"], fast: [] },
    };
    const chain = modelChainFor(
      models,
      { role: "main" },
      {
        http: createRecordedHttp([]),
        clock,
        rests: new Map(),
      },
    );
    const events = await eventsOfTransport(chain.models[1]?.transport);
    expect(events).toStrictEqual([
      {
        type: "error",
        failure: "request",
        message: "The provider of a model in models.fallbacks.main is not in models.providers.",
      },
    ]);
  });
});
