import type { Clock, Http, HttpRequest } from "@binference/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createBufferedHttp } from "./buffered-http.js";
import { type ImageMaker, imageMakerFor, type ImageMakingRequest } from "./image-making.js";

const clock: Clock = { now: () => 1_760_000_000_000, sleep: async () => Promise.resolve() };
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const providers = {
  openai: { kind: "openai", baseUrl: "https://images.example.test/v1", apiKey: "sk-test" },
  claude: { kind: "anthropic" },
  binference: {
    kind: "binference",
    baseUrl: "https://gateway.example.test/api/v1",
    apiKey: "bk-test",
  },
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

const dataUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
const imageModels = {
  object: "list",
  data: [
    {
      id: "openai/gpt-5.4-image-2",
      reads_images: true,
      parameters: {
        aspect_ratio: { type: "enum", values: ["1:1", "3:2", "2:3", "auto"] },
        quality: { type: "enum", values: ["auto", "low", "medium", "high"] },
        output_format: { type: "enum", values: ["png", "jpeg", "webp"] },
        background: { type: "enum", values: ["auto", "opaque"] },
        n: { type: "range", min: 1, max: 2 },
      },
    },
    {
      id: "google/gemini-3.1-flash-image",
      reads_images: false,
      parameters: {
        resolution: { type: "enum", values: ["1K", "2K", "4K"] },
        aspect_ratio: { type: "enum", values: ["1:1", "3:2"] },
        n: { type: "range", min: 1, max: 1 },
      },
    },
  ],
};

// A gateway that lists its image models and answers each image call with one body.
function gatewayOf(made: object) {
  const requests: HttpRequest[] = [];
  const answerTo = (sent: HttpRequest) =>
    sent.url.endsWith("/images/models") ? imageModels : made;
  const http: Http = {
    request: async (sent) => {
      requests.push(sent);
      const body = JSON.stringify(answerTo(sent));
      return Promise.resolve({
        status: 200,
        headers: { "content-type": "application/json" },
        body,
      });
    },
  };
  return {
    parts: { http: createBufferedHttp(http), clock },
    listReads: () => requests.filter(({ url }) => url.endsWith("/images/models")).length,
    sent: () =>
      requests
        .filter(({ method }) => method === "POST")
        .map(({ url, body }) => ({ url, body: sentSchema.parse(JSON.parse(String(body))) })),
  };
}

const sentSchema = z.record(z.string(), z.unknown());
const gatewayMade = {
  created: 1_760_000_000,
  data: [{ b64_json: Buffer.from(png).toString("base64"), media_type: "image/png" }],
  usage: { cost: 0.0084 },
};

// A gateway whose first image model list read fails, as a dropped connection does.
function flakyGatewayParts() {
  const reads = { failed: 0 };
  const answerTo = (sent: HttpRequest) => {
    const isList = sent.url.endsWith("/images/models");
    if (isList && reads.failed === 0) {
      reads.failed += 1;
      return undefined;
    }
    return isList ? imageModels : gatewayMade;
  };
  const http: Http = {
    request: async (sent) => {
      const answer = answerTo(sent);
      return answer === undefined
        ? Promise.reject(new Error("socket hang up"))
        : Promise.resolve({
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(answer),
          });
    },
  };
  return { http: createBufferedHttp(http), clock };
}

// The bytes of a request's form, empty for a request with none.
function formOf(sent: HttpRequest | undefined): string {
  return new TextDecoder("latin1").decode(sent?.bodyBytes ?? new Uint8Array());
}

// The maker of the test's image model; a refusal fails the test that needed a maker.
function makerOn(
  parts: ReturnType<typeof providerOf>["parts"],
  imageMaking = "openai/gpt-image-1",
): ImageMaker {
  const maker = imageMakerFor({ providers, imageMaking }, parts);
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
      "cannot make images",
    );
    expect(imageMakerFor({ providers, imageMaking: "none/x" }, parts)).toContain(
      "not in models.providers",
    );
  });

  it("makes images on the gateway's image endpoint with only the fields the model lists", async () => {
    const gateway = gatewayOf(gatewayMade);
    const maker = makerOn(gateway.parts, "binference/openai/gpt-5.4-image-2");
    const asked: ImageMakingRequest = {
      ...request,
      count: 4,
      size: "1536x1024",
      quality: "high",
      background: "transparent",
      references: [{ contentType: "image/png", bytes: png }],
    };
    const made = await maker.make(asked, new AbortController().signal);
    await maker.make(request, new AbortController().signal);
    expect(made).toStrictEqual({ ok: true, images: [png] });
    expect([gateway.listReads(), gateway.sent()[0]]).toStrictEqual([
      1,
      {
        url: "https://gateway.example.test/api/v1/images",
        body: {
          model: "openai/gpt-5.4-image-2",
          prompt: "A frog logo.",
          n: 2,
          aspect_ratio: "3:2",
          quality: "high",
          output_format: "png",
          input_references: [{ type: "image_url", image_url: { url: dataUrl } }],
        },
      },
    ]);
  });

  it("asks a model for the smallest tier it lists and leaves out images it cannot read", async () => {
    const gateway = gatewayOf(gatewayMade);
    const maker = makerOn(gateway.parts, "binference/google/gemini-3.1-flash-image");
    const references = [{ contentType: "image/png" as const, bytes: png }];
    const asked = { ...request, count: 3, size: "1024x1024" as const, references };
    await maker.make(asked, new AbortController().signal);
    expect(gateway.sent().map(({ body }) => body)).toStrictEqual([
      {
        model: "google/gemini-3.1-flash-image",
        prompt: "A frog logo.",
        n: 1,
        resolution: "1K",
        aspect_ratio: "1:1",
      },
    ]);
  });

  it("names a model the gateway does not list as an image model, and sends nothing", async () => {
    const gateway = gatewayOf(gatewayMade);
    const made = await makerOn(gateway.parts, "binference/openai/gpt-6-luna").make(
      request,
      new AbortController().signal,
    );
    expect([made, gateway.sent()]).toStrictEqual([
      {
        ok: false,
        failure:
          "binference/openai/gpt-6-luna is not one of the gateway's image models: the owner sets models.imageMaking to one of GET /images/models, such as binference/openai/gpt-image-2",
      },
      [],
    ]);
  });

  it("reads the model list again after a failed read, never taking the failure for an unknown model", async () => {
    const parts = flakyGatewayParts();
    const maker = makerOn(parts, "binference/openai/gpt-5.4-image-2");
    const first = await maker.make(request, new AbortController().signal);
    const second = await maker.make(request, new AbortController().signal);
    expect([first.ok, second]).toStrictEqual([false, { ok: true, images: [png] }]);
  });

  it("refuses images to start from that the gateway's 4 MB request limit cannot carry", async () => {
    const gateway = gatewayOf(gatewayMade);
    const large = new Uint8Array(3_100_000);
    const references = [{ contentType: "image/png" as const, bytes: large }];
    const made = await makerOn(gateway.parts, "binference/openai/gpt-5.4-image-2").make(
      { ...request, references },
      new AbortController().signal,
    );
    expect([made, gateway.sent()]).toStrictEqual([
      {
        ok: false,
        failure:
          "the images to start from are too large to send: the gateway takes at most 4 MB per request, so use fewer or smaller images",
      },
      [],
    ]);
  });

  it("says what the gateway said when it sends an error inside a successful answer", async () => {
    const gateway = gatewayOf({
      id: "gen-1",
      error: { message: "Provider returned error", code: 502 },
    });
    const made = await makerOn(gateway.parts, "binference/openai/gpt-5.4-image-2").make(
      request,
      new AbortController().signal,
    );
    expect(made).toStrictEqual({
      ok: false,
      failure: "the provider said: Provider returned error (code 502)",
    });
  });
});
