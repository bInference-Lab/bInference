import { describe, expect, it } from "vitest";
import { createRecordedHttp } from "../testing/recorded-http.js";
import { createModelFetch } from "./model-fetch.js";

const baseUrl = "https://models.example.test/v1";
const answer = { status: 200, headers: { "content-type": "text/event-stream" }, chunks: ["ok"] };

function fetchOn(withKey = true) {
  const http = createRecordedHttp([answer]);
  return { http, modelFetch: createModelFetch({ http, baseUrl, withKey }) };
}

const init = (extra: RequestInit = {}): RequestInit => ({
  method: "POST",
  body: "{}",
  signal: new AbortController().signal,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: "Bearer sk-test-key",
    "X-Stainless-OS": "MacOS",
    "OpenAI-Organization": "org-stray",
    "User-Agent": "OpenAI/JS 7.28.0",
  },
  ...extra,
});

describe("createModelFetch", () => {
  it("sends only the allowed headers and streams the answer back", async () => {
    const { http, modelFetch } = fetchOn();
    const response = await modelFetch(`${baseUrl}/chat/completions`, init());
    expect([response.status, await response.text()]).toStrictEqual([200, "ok"]);
    expect(http.requests[0]?.headers).toStrictEqual({
      accept: "application/json",
      "content-type": "application/json",
      authorization: "Bearer sk-test-key",
    });
  });

  it("sends no authorization for a provider without a key", async () => {
    const { http, modelFetch } = fetchOn(false);
    await modelFetch(new URL(`${baseUrl}/chat/completions`), init());
    expect(http.requests[0]?.headers).not.toHaveProperty("authorization");
  });

  it.each([
    ["an address outside the base URL", "https://elsewhere.test/v1/chat/completions", init()],
    ["a base URL's look-alike", "https://models.example.test/v10/chat", init()],
    ["a GET request", `${baseUrl}/models`, init({ method: "GET" })],
    ["a body that is not text", `${baseUrl}/chat/completions`, init({ body: new Uint8Array(2) })],
    ["a request with no signal", `${baseUrl}/chat/completions`, init({ signal: null })],
  ])("refuses %s before it leaves", async (_case, url, given) => {
    const { http, modelFetch } = fetchOn();
    await expect(modelFetch(url, given)).rejects.toThrow(
      expect.objectContaining({ code: "runtime.model_request_refused" }),
    );
    expect(http.requests).toHaveLength(0);
  });

  it("answers a status without a body as an empty answer", async () => {
    const http = createRecordedHttp([{ status: 204, headers: {}, chunks: [] }]);
    const modelFetch = createModelFetch({ http, baseUrl, withKey: true });
    const response = await modelFetch(`${baseUrl}/chat/completions`, init());
    expect([response.status, response.body]).toStrictEqual([204, null]);
  });
});
