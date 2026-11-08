import type { Clock, HttpRequest } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { StreamingHttp } from "./ports.js";
import { type SpeechMaker, speechSourceFor } from "./speech-making.js";

const clock: Clock = { now: () => 1_760_000_000_000, sleep: async () => Promise.resolve() };
const opus = new TextEncoder().encode("OggS opus pages");
const providers = {
  oa: { kind: "openai", baseUrl: "https://speech.example.test/v1", apiKey: "sk-test" },
  binference: { kind: "binference", baseUrl: "https://gateway.example.test/api/v1" },
} as const;
const live = new AbortController().signal;

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array, void, undefined> {
  yield await Promise.resolve(bytes);
}

// A provider that answers each request with one status and body, and keeps each request.
function providerOf(status: number, body: Uint8Array) {
  const requests: HttpRequest[] = [];
  const http: StreamingHttp = {
    open: async (request) => {
      requests.push(request);
      return Promise.resolve({
        status,
        headers: { "content-type": "audio/ogg" },
        body: once(body),
      });
    },
  };
  return { requests, parts: { http, clock } };
}

function makerOn(parts: ReturnType<typeof providerOf>["parts"]): SpeechMaker {
  const source = speechSourceFor({ providers, speech: "oa/gpt-4o-mini-tts" }, parts);
  if (source.kind !== "model") {
    throw new TypeError("No speech model.");
  }
  return source.maker;
}

describe("speech a model speaks", () => {
  it("asks the provider's /audio/speech for Ogg Opus in the voice asked, alloy by default", async () => {
    const provider = providerOf(200, opus);
    const maker = makerOn(provider.parts);
    expect(await maker.speak({ text: "Your buy filled." }, live)).toStrictEqual({
      ok: true,
      audio: opus,
    });
    await maker.speak({ text: "Again.", voice: "verse" }, live);
    const [first, second] = provider.requests;
    expect(first?.url).toBe("https://speech.example.test/v1/audio/speech");
    expect(first?.headers).toMatchObject({ authorization: "Bearer sk-test" });
    expect(JSON.parse(String(first?.body))).toStrictEqual({
      model: "gpt-4o-mini-tts",
      input: "Your buy filled.",
      voice: "alloy",
      response_format: "opus",
    });
    expect(JSON.parse(String(second?.body))).toMatchObject({ voice: "verse" });
  });

  it("says what the provider refused, and an answer with no audio", async () => {
    const refused = providerOf(401, new TextEncoder().encode('{"error":{"message":"Bad key."}}'));
    const said = await makerOn(refused.parts).speak({ text: "Hi." }, live);
    expect(said).toMatchObject({ ok: false });
    expect(JSON.stringify(said)).toContain("the provider said:");
    const empty = providerOf(200, new Uint8Array());
    expect(await makerOn(empty.parts).speak({ text: "Hi." }, live)).toStrictEqual({
      ok: false,
      failure: "the model answered with no audio binference keeps",
    });
  });

  it("names the machine's own voice for local, and why nothing speaks otherwise", () => {
    const { parts } = providerOf(200, opus);
    expect(speechSourceFor({ providers, speech: "local" }, parts)).toStrictEqual({ kind: "local" });
    expect(speechSourceFor({ providers }, parts)).toMatchObject({ kind: "none" });
    expect(
      JSON.stringify(speechSourceFor({ providers, speech: "binference/tts" }, parts)),
    ).toContain("not an openai provider");
  });
});
