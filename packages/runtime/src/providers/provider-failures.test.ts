import type { Clock } from "@binference/core";
import { describe, expect, it } from "vitest";
import { stepAfter } from "../loop/attempt-policy.js";
import type { ModelEvent } from "../loop/model-event.js";
import type { ModelTransport } from "../loop/ports.js";
import type { ProviderFailureCase } from "../testing/failure-answers.js";
import { providerFailureCases } from "../testing/provider-failures.js";
import { createRecordedHttp } from "../testing/recorded-http.js";
import { createChatCompletionsTransport } from "./chat-completions-transport.js";
import { createMessagesTransport } from "./messages-transport.js";

const clock: Clock = { now: () => 1_760_000_000_000, sleep: async () => Promise.resolve() };

function transportFor(item: ProviderFailureCase): ModelTransport {
  const http = createRecordedHttp([item.answer]);
  const common = { apiKey: "test-key", timeoutMs: 120_000, http, clock };
  return item.provider === "anthropic"
    ? createMessagesTransport({
        ...common,
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-5-5",
      })
    : createChatCompletionsTransport({
        ...common,
        baseUrl: "https://models.example.test/v1",
        model: "gpt-5-mini",
      });
}

async function lastEventOf(item: ProviderFailureCase): Promise<ModelEvent | undefined> {
  const request = {
    prefix: "",
    messages: [{ role: "owner", text: "hi" } as const],
    tools: [],
  };
  const events: ModelEvent[] = [];
  for await (const event of transportFor(item).stream(request, new AbortController().signal)) {
    events.push(event);
  }
  return events.at(-1);
}

const stepKind = { retry: "retry", next: "next", end: "end" } as const;

// The last event a case's transport must end with.
function expectedEnd(item: ProviderFailureCase) {
  return {
    type: "error",
    failure: item.failure,
    message: expect.any(String) as unknown,
    ...(item.retryAfterMs === undefined ? {} : { retryAfterMs: item.retryAfterMs }),
  };
}

describe("the documented failures of OpenAI, Anthropic and OpenRouter", () => {
  it.each(providerFailureCases.map((item) => [item.provider, item.name, item] as const))(
    "classes %s's %s",
    async (_provider, _name, item) => {
      await expect(lastEventOf(item)).resolves.toStrictEqual(expectedEnd(item));
    },
  );

  it.each(providerFailureCases.map((item) => [item.provider, item.name, item] as const))(
    "takes the documented next step for %s's %s",
    (_provider, _name, item) => {
      const step = stepAfter({ ...item, attempts: 1, retries: 0, committed: false });
      expect(step.kind).toBe(stepKind[item.step]);
    },
  );
});
