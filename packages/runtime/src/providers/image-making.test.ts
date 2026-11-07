import type { Clock, Http, HttpRequest } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createBufferedHttp } from "./buffered-http.js";
import { type ImageMaker, imageMakerFor, type ImageMakingRequest } from "./image-making.js";

const clock: Clock = { now: () => 1_760_000_000_000, sleep: async () => Promise.resolve() };
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const providers = {
  openai: { kind: "openai", baseUrl: "https://images.example.test/v1", apiKey: "sk-test" },
  claude: { kind: "anthropic" },
} as const;
const request: ImageMakingRequest = {
  prompt: "A frog logo.",
  count: 1,
  outputFormat: "png",
  references: [],
};

// A provider that answers every request with one status and body, and keeps each request.
function providerOf(status: number, body: object) {
  const requests: HttpRequest[] = [];
  const http: Http = {
    request: async (sent) => {
      requests.push(sent);
      return Promise.resolve({
        status,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
  };
  return { requests, parts: { http: createBufferedHttp(http), clock } };
}

// The bytes of a request's form, empty for a request with none.
function formOf(sent: HttpRequest | undefined): string {
  return new TextDecoder("latin1").decode(sent?.bodyBytes ?? new Uint8Array());
}

// The maker of the test's image model; a refusal fails the test that needed a maker.
function makerOn(parts: ReturnType<typeof providerOf>["parts"]): ImageMaker {
  const maker = imageMakerFor({ providers, imageMaking: "openai/gpt-image-1" }, parts);
  if (typeof maker === "string") {
    throw new TypeError(maker);
  }
  return maker;
}

const answered = {
  data: [{ b64_json: Buffer.from(png).toString("base64") }],
  usage: { input_tokens: 12, output_tokens: 3_000, total_tokens: 3_012, input_tokens_details: {} },
};

describe("the image model", () => {
  it("makes images through the Images API with the provider's key, and reads their usage", async () => {
    const provider = providerOf(200, answered);
    const made = await makerOn(provider.parts).make(request, new AbortController().signal);
    expect(made).toStrictEqual({
      ok: true,
      images: [png],
      usage: { inputTokens: 12, outputTokens: 3_000, cachedTokens: 0 },
    });
    expect(provider.requests).toMatchObject([
      {
        url: "https://images.example.test/v1/images/generations",
        headers: { authorization: "Bearer sk-test" },
      },
    ]);
    expect(JSON.parse(String(provider.requests[0]?.body))).toStrictEqual({
      model: "gpt-image-1",
      prompt: "A frog logo.",
      n: 1,
      output_format: "png",
    });
  });

  it("edits reference images sent as a form, and names why a request failed", async () => {
    const edit = providerOf(200, answered);
    const references = [{ contentType: "image/png" as const, bytes: png }];
    await makerOn(edit.parts).make({ ...request, references }, new AbortController().signal);
    expect(edit.requests.map((sent) => sent.url)).toStrictEqual([
      "https://images.example.test/v1/images/edits",
    ]);
    expect(edit.requests[0]?.headers?.["content-type"]).toMatch(
      /^multipart\/form-data; boundary=/u,
    );
    expect(formOf(edit.requests[0])).toContain('filename="reference-0.png"');
    const refused = providerOf(400, { error: { message: "Your prompt was refused." } });
    const failed = await makerOn(refused.parts).make(request, new AbortController().signal);
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).toContain("Your prompt was refused.");
  });

  it("says which setting to set without a model, or with a provider of another API", () => {
    const parts = providerOf(200, answered).parts;
    expect(imageMakerFor({ providers }, parts)).toContain("models.imageMaking");
    expect(imageMakerFor({ providers, imageMaking: "claude/any" }, parts)).toContain(
      "does not speak OpenAI's Images API",
    );
    expect(imageMakerFor({ providers, imageMaking: "none/x" }, parts)).toContain(
      "not in models.providers",
    );
  });
});
