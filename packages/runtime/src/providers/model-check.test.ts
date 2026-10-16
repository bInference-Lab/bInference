import {
  BinferenceError,
  type Clock,
  createSecret,
  err,
  type Http,
  type HttpRequest,
  ok,
} from "@binference/core";
import { describe, expect, it } from "vitest";
import { anthropicAnswer, openaiAnswer, openrouterAnswer } from "../testing/failure-answers.js";
import type { RecordedAnswer } from "../testing/recorded-http.js";
import {
  checkModel,
  checkModelImages,
  type ModelCheckProblem,
  type ModelCheckTarget,
} from "./model-check.js";

const clock: Clock = { now: () => 1_760_000_000_000, sleep: async () => Promise.resolve() };
const key = "sk-test-check-key";
const json = { "content-type": "application/json" };
const chatAnswer: RecordedAnswer = {
  status: 200,
  headers: json,
  chunks: [JSON.stringify({ id: "c1", object: "chat.completion", choices: [{ index: 0 }] })],
};
const messagesAnswer: RecordedAnswer = {
  status: 200,
  headers: json,
  chunks: [JSON.stringify({ id: "m1", type: "message", role: "assistant", content: [] })],
};
const page: RecordedAnswer = {
  status: 200,
  headers: { "content-type": "text/html" },
  chunks: ["<html><body>Sign in</body></html>"],
};

const targets = {
  openai: { kind: "openai", baseUrl: "https://models.example.test/v1", model: "gpt-test" },
  anthropic: { kind: "anthropic", model: "claude-test" },
  openrouter: { kind: "openai", baseUrl: "https://router.example.test/api/v1", model: "x/y" },
} as const;

// A provider that answers every request with one answer, or never answers, and keeps each.
function providerOf(answer: RecordedAnswer | "silent") {
  const requests: HttpRequest[] = [];
  const http: Http = {
    request: async (request) => {
      requests.push(request);
      if (answer === "silent") {
        throw new BinferenceError({ code: "http.unreachable", message: "No answer came." });
      }
      return { status: answer.status, headers: answer.headers, body: answer.chunks.join("") };
    },
  };
  return { http, requests };
}

async function check(target: Omit<ModelCheckTarget, "apiKey">, answer: RecordedAnswer | "silent") {
  const provider = providerOf(answer);
  const parts = {
    http: provider.http,
    clock,
    timeoutMs: 5_000,
    signal: AbortSignal.timeout(5_000),
  };
  const outcome = await checkModel({ ...target, apiKey: createSecret(key) }, parts);
  return { outcome, requests: provider.requests };
}

function bodyOf(request: HttpRequest | undefined): unknown {
  return JSON.parse(request?.body ?? "null");
}

describe("the model check", () => {
  it("sends one small Chat Completions call with the key in its header", async () => {
    const { outcome, requests } = await check(targets.openai, chatAnswer);
    expect(outcome).toStrictEqual(ok(undefined));
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect([request?.method, request?.url]).toStrictEqual([
      "POST",
      "https://models.example.test/v1/chat/completions",
    ]);
    expect(request?.headers?.["authorization"]).toBe(`Bearer ${key}`);
    expect(bodyOf(request)).toStrictEqual({
      model: "gpt-test",
      messages: [{ role: "user", content: "Hi" }],
      max_completion_tokens: 16,
    });
  });

  it("sends one Messages call of one output token to Anthropic's API by default", async () => {
    const { outcome, requests } = await check(targets.anthropic, messagesAnswer);
    expect(outcome).toStrictEqual(ok(undefined));
    const [request] = requests;
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request?.headers).toMatchObject({ "x-api-key": key, "anthropic-version": "2023-06-01" });
    expect(bodyOf(request)).toStrictEqual({
      model: "claude-test",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1,
    });
  });

  it("calls OpenAI's API for the openai kind without a base URL", async () => {
    const { requests } = await check({ kind: "openai", model: "gpt-test" }, chatAnswer);
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  const cases: readonly (readonly [
    string,
    Omit<ModelCheckTarget, "apiKey">,
    RecordedAnswer | "silent",
    ModelCheckProblem,
  ])[] = [
    [
      "an incorrect key",
      targets.openai,
      openaiAnswer(401, {
        message: "Incorrect API key provided.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      }),
      "bad_key",
    ],
    [
      "Anthropic's refused key",
      targets.anthropic,
      anthropicAnswer(401, { type: "authentication_error", message: "invalid x-api-key" }),
      "bad_key",
    ],
    [
      "a key without the permission",
      targets.anthropic,
      anthropicAnswer(403, { type: "permission_error", message: "Not allowed." }),
      "bad_key",
    ],
    [
      "spent quota",
      targets.openai,
      openaiAnswer(429, {
        message: "You exceeded your current quota.",
        type: "insufficient_quota",
        code: "insufficient_quota",
      }),
      "no_credit",
    ],
    [
      "no credits left",
      targets.openrouter,
      openrouterAnswer(402, { message: "Insufficient credits." }),
      "no_credit",
    ],
    [
      "Anthropic's billing error",
      targets.anthropic,
      anthropicAnswer(400, { type: "billing_error", message: "Your credit balance is too low." }),
      "no_credit",
    ],
    [
      "the rate limit",
      targets.openai,
      openaiAnswer(429, {
        message: "Rate limit reached.",
        type: "requests",
        code: "rate_limit_exceeded",
      }),
      "rate_limited",
    ],
    [
      "Anthropic's rate limit",
      targets.anthropic,
      anthropicAnswer(429, { type: "rate_limit_error", message: "Slow down." }),
      "rate_limited",
    ],
    [
      "a model that does not exist",
      targets.openai,
      openaiAnswer(404, {
        message: "The model `gpt-test` does not exist or you do not have access to it.",
        type: "invalid_request_error",
        code: "model_not_found",
      }),
      "unknown_model",
    ],
    [
      "Anthropic's unknown model",
      targets.anthropic,
      anthropicAnswer(404, { type: "not_found_error", message: "model: claude-test" }),
      "unknown_model",
    ],
    [
      "a model id the router does not know",
      targets.openrouter,
      openrouterAnswer(400, { message: "x/y is not a valid model ID" }),
      "unknown_model",
    ],
    [
      "a path the address does not serve",
      targets.anthropic,
      anthropicAnswer(404, { type: "not_found_error", message: "Not Found" }),
      "rejected",
    ],
    ["a page in place of the API", targets.openai, { ...page, status: 404 }, "rejected"],
    ["a page that answers 200", targets.openai, page, "rejected"],
    [
      "another refused request",
      targets.openai,
      openaiAnswer(400, {
        message: "Unsupported parameter.",
        type: "invalid_request_error",
        code: null,
      }),
      "rejected",
    ],
    ["a server error", targets.openai, { status: 503, headers: {}, chunks: [] }, "unreachable"],
    [
      "an overloaded provider",
      targets.anthropic,
      anthropicAnswer(529, { type: "overloaded_error", message: "Overloaded" }),
      "unreachable",
    ],
    ["no answer", targets.openai, "silent", "unreachable"],
  ];

  const rows = cases.map(([name, target, answer, problem]) => ({ name, target, answer, problem }));

  it.each(rows)("names $name", async ({ target, answer, problem }) => {
    const { outcome, requests } = await check(target, answer);
    expect(outcome).toStrictEqual(err(problem));
    expect(requests).toHaveLength(1);
  });

  it("sends one 1x1 PNG in each API's own image format for the image check", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    const parts = { clock, timeoutMs: 5_000, signal: AbortSignal.timeout(5_000) };
    const chat = providerOf(chatAnswer);
    const messages = providerOf(messagesAnswer);
    const outcomes = await Promise.all([
      checkModelImages(
        { ...targets.openai, apiKey: createSecret(key) },
        { ...parts, http: chat.http },
      ),
      checkModelImages(
        { ...targets.anthropic, apiKey: createSecret(key) },
        { ...parts, http: messages.http },
      ),
    ]);
    expect(outcomes).toStrictEqual([ok(undefined), ok(undefined)]);
    expect(bodyOf(chat.requests[0])).toMatchObject({
      max_completion_tokens: 16,
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: png } }, { type: "text" }],
        },
      ],
    });
    expect(bodyOf(messages.requests[0])).toMatchObject({
      max_tokens: 1,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png" } },
            { type: "text" },
          ],
        },
      ],
    });
  });

  it("answers a problem for a model that refuses the image", async () => {
    const refused: RecordedAnswer = {
      status: 400,
      headers: json,
      chunks: [
        JSON.stringify({
          error: {
            message: "Invalid content type. image_url is only supported by certain models.",
            type: "invalid_request_error",
            param: "messages.[0].content.[0].type",
            code: null,
          },
        }),
      ],
    };
    const provider = providerOf(refused);
    const parts = {
      http: provider.http,
      clock,
      timeoutMs: 5_000,
      signal: AbortSignal.timeout(5_000),
    };
    const outcome = await checkModelImages({ ...targets.openai, apiKey: createSecret(key) }, parts);
    expect(outcome).toMatchObject({ ok: false });
  });
});
