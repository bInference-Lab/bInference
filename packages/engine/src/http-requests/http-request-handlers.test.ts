import {
  BinferenceError,
  type Http,
  type HttpRequest,
  type HttpResponse,
  idSchema,
} from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { HttpRequestArgs } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createRunningTurns } from "../chat/running-turns.js";
import { createMemoryCredentialStore } from "../fakes/memory-credential-store.js";
import { testAgent } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import { createHttpRequestHandlers } from "./http-request-handlers.js";

const key = "sk-live-4f1c9a2e7b3d";
const runtime = testCallers.runtime;
const marked: EngineCaller = { ...runtime, turn: { hasOutsideContent: true } };

const json = (body: string, headers: Readonly<Record<string, string>> = {}): HttpResponse => ({
  status: 200,
  headers: { "content-type": "application/json", ...headers },
  body,
});

type Answer = (request: HttpRequest) => Promise<HttpResponse>;

/** A credential a test stores, beside API_KEY for api.example.com and OTHER_KEY. */
interface Stored {
  readonly name: string;
  readonly value: string;
}

const stored: readonly Stored[] = [
  { name: "API_KEY", value: key },
  { name: "OTHER_KEY", value: "o-9" },
  { name: "SPACED", value: "a b&c" },
  { name: "LINES", value: "a\r\nHost: evil" },
];

const hostsOf: Readonly<Record<string, readonly string[]>> = { OTHER_KEY: ["other.example"] };

async function setUp(answer: Answer = async () => Promise.resolve(json("{}"))) {
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtime.credential));
  const credentials = createMemoryCredentialStore();
  const signal = new AbortController().signal;
  for (const { name, value } of stored) {
    const allowedHosts = hostsOf[name] ?? ["api.example.com"];
    // oxlint-disable-next-line eslint/no-await-in-loop -- the store takes one write at a time
    await credentials.put({ name, value, allowedHosts, atMs: 1 }, { signal });
  }
  const sent: HttpRequest[] = [];
  const http: Http = {
    request: async (request) => {
      sent.push(request);
      return answer(request);
    },
  };
  const clock = createManualClock(Date.UTC(2026, 10, 11, 12));
  const logger = createMemoryLogger({ subsystem: "engine.requests" });
  const requests = {
    http,
    reveal: async (name: string, call: { readonly signal: AbortSignal }) =>
      credentials.reveal(name, call),
    ownHosts: () => ["Mac.Tail1234.ts.net."],
    logger,
  };
  const handler = createHttpRequestHandlers({ requests, turns, clock })["http/request"];
  const run = async (args: Omit<HttpRequestArgs, "agent">, caller = runtime) =>
    handler(testCall({ agent: testAgent, ...args }, caller));
  return { run, handler, sent, logger, clock };
}

const get = (url: string): Omit<HttpRequestArgs, "agent"> => ({ method: "GET", url });
const refused = (view: object) => ({ ok: true, value: { kind: "refused", ...view } });

describe("the agent's API calls", () => {
  it("puts a credential in for a host it lists, header, query and body alike", async () => {
    const test = await setUp();
    const answer = await test.run({
      method: "POST",
      url: "https://api.example.com/v1/q?key={{credential:API_KEY}}&n=1",
      headers: [{ name: "Authorization", value: "Bearer {{credential:API_KEY}}" }],
      body: '{"token":"{{credential:API_KEY}}"}',
    });
    expect(answer.ok).toBe(true);
    expect(test.sent).toMatchObject([
      {
        method: "POST",
        url: `https://api.example.com/v1/q?key=${key}&n=1`,
        headers: { Authorization: `Bearer ${key}` },
        body: `{"token":"${key}"}`,
        publicOnly: true,
      },
    ]);
  });

  it("percent-encodes a value in the query only", async () => {
    const test = await setUp();
    await test.run({
      method: "GET",
      url: "https://API.example.com./?k={{credential:SPACED}}",
      headers: [{ name: "X-Key", value: "{{credential:SPACED}}" }],
    });
    expect(test.sent[0]?.url).toBe("https://api.example.com./?k=a%20b%26c");
    expect(test.sent[0]?.headers).toStrictEqual({ "X-Key": "a b&c" });
  });

  it.each([
    {
      name: "a host the credential does not list",
      url: "https://evil.example/?k={{credential:API_KEY}}",
      view: { reason: "credential_host", credential: "API_KEY", host: "evil.example" },
    },
    {
      name: "a subdomain of its host",
      url: "https://eu.api.example.com/?k={{credential:API_KEY}}",
      view: { reason: "credential_host", credential: "API_KEY", host: "eu.api.example.com" },
    },
    {
      name: "another port of its host",
      url: "https://api.example.com:8443/?k={{credential:API_KEY}}",
      view: { reason: "credential_host", credential: "API_KEY", host: "api.example.com:8443" },
    },
    {
      name: "a credential that is not stored",
      url: "https://api.example.com/?k={{credential:NO_SUCH_KEY}}",
      view: { reason: "credential_unknown", credential: "NO_SUCH_KEY", host: "api.example.com" },
    },
    {
      name: "a stand-in in the path",
      url: "https://api.example.com/{{credential:API_KEY}}/q",
      view: { reason: "standin_place", host: "api.example.com" },
    },
    {
      name: "a stand-in in the fragment",
      url: "https://api.example.com/q#{{credential:API_KEY}}",
      view: { reason: "standin_place", host: "api.example.com" },
    },
    {
      name: "a stand-in with no query to sit in",
      url: "https://api.example.com/q#?{{credential:API_KEY}}",
      view: { reason: "standin_place", host: "api.example.com" },
    },
    {
      name: "a stand-in with no credential's name",
      url: "https://api.example.com/?k={{credential:api key}}",
      view: { reason: "standin_malformed", host: "api.example.com" },
    },
  ] as const)("refuses $name before anything is sent", async ({ url, view }) => {
    const test = await setUp();
    await expect(test.run(get(url))).resolves.toStrictEqual(refused(view));
    expect(test.sent).toStrictEqual([]);
  });

  it("refuses the whole request when one of its credentials may not go", async () => {
    const test = await setUp();
    const answer = await test.run({
      method: "GET",
      url: "https://api.example.com/?k={{credential:API_KEY}}",
      headers: [{ name: "X-Other", value: "{{credential:OTHER_KEY}}" }],
    });
    const view = { reason: "credential_host", credential: "OTHER_KEY", host: "api.example.com" };
    expect(answer).toStrictEqual(refused(view));
    expect(test.sent).toStrictEqual([]);
  });

  it("refuses a value a header cannot carry", async () => {
    const test = await setUp();
    const answer = await test.run({
      method: "GET",
      url: "https://api.example.com/",
      headers: [{ name: "X-Key", value: "{{credential:LINES}}" }],
    });
    const view = { reason: "value_unfit", credential: "LINES", host: "api.example.com" };
    expect(answer).toStrictEqual(refused(view));
    expect(test.sent).toStrictEqual([]);
  });

  it.each([
    ["plain http", "http://api.example.com/v1"],
    ["a private address", "https://10.0.0.8/v1"],
    ["this machine", "https://127.0.0.1:7457/v1"],
    ["a local name", "https://printer.local/v1"],
    ["binference's own public address", "https://mac.tail1234.ts.net/hook/a/b"],
    ["a user name in the URL", "https://me:pw@api.example.com/"],
    ["no URL at all", "api.example.com/v1"],
  ])("refuses %s before anything is sent", async (_name, url) => {
    const test = await setUp();
    await expect(test.run(get(url))).resolves.toStrictEqual({
      ok: false,
      error: "request.address_refused",
    });
    expect(test.sent).toStrictEqual([]);
  });

  it("refuses a write with a credential in a marked turn, and lets a read go", async () => {
    const test = await setUp();
    const headers = [{ name: "Authorization", value: "Bearer {{credential:API_KEY}}" }];
    const url = "https://api.example.com/v1/orders";
    const write = { method: "POST", url, headers, body: "{}" } as const;
    const view = { reason: "credential_outside", credential: "API_KEY", host: "api.example.com" };
    await expect(test.run(write, marked)).resolves.toStrictEqual(refused(view));
    const { turn: _turn, ...unmarked } = runtime;
    await expect(test.run(write, unmarked)).resolves.toStrictEqual(refused(view));
    await expect(test.run({ ...write, method: "DELETE" }, marked)).resolves.toStrictEqual(
      refused(view),
    );
    expect(test.sent).toStrictEqual([]);
    expect((await test.run({ method: "GET", url, headers }, marked)).ok).toBe(true);
    expect((await test.run({ method: "HEAD", url, headers }, marked)).ok).toBe(true);
    expect((await test.run({ ...write, headers: [] }, marked)).ok).toBe(true);
    expect((await test.run(write)).ok).toBe(true);
    expect(test.sent.map(({ method }) => method)).toStrictEqual(["GET", "HEAD", "POST", "POST"]);
  });

  it("answers a redirect with its status and location, and follows none", async () => {
    const location = "https://login.example/next";
    const test = await setUp(async () =>
      Promise.resolve({ status: 302, headers: { location }, body: "" }),
    );
    const answer = await test.run(get("https://api.example.com/old?k={{credential:API_KEY}}"));
    expect(answer).toMatchObject({
      ok: true,
      value: { kind: "answer", status: 302, headers: [{ name: "location", value: location }] },
    });
    expect(test.sent).toHaveLength(1);
  });

  it("masks every value the site echoes back, in the body and the headers", async () => {
    const test = await setUp(async (request) =>
      Promise.resolve(
        json(JSON.stringify({ headers: request.headers, url: request.url }), {
          location: `https://api.example.com/next?key=${encodeURIComponent("a b&c")}`,
          "x-ratelimit-remaining": `9 ${key}`,
          "set-cookie": `session=${key}`,
        }),
      ),
    );
    const answer = await test.run({
      method: "GET",
      url: "https://api.example.com/v1?key={{credential:API_KEY}}&s={{credential:SPACED}}",
      headers: [{ name: "Authorization", value: "Bearer {{credential:API_KEY}}" }],
    });
    const text = JSON.stringify(answer);
    expect(text).not.toContain(key);
    expect(text).not.toContain("a%20b");
    expect(answer).toMatchObject({
      value: {
        body: JSON.stringify({
          headers: { Authorization: "Bearer {{credential:API_KEY}}" },
          url: "https://api.example.com/v1?key={{credential:API_KEY}}&s={{credential:SPACED}}",
        }),
        headers: [
          { name: "content-type", value: "application/json" },
          { name: "location", value: "https://api.example.com/next?key={{credential:SPACED}}" },
          { name: "x-ratelimit-remaining", value: "9 {{credential:API_KEY}}" },
        ],
      },
    });
  });

  it("answers a failure by its code alone, with no value in it or the log", async () => {
    const message = `refused ${key}`;
    const test = await setUp(async () =>
      Promise.reject(new BinferenceError({ code: "http.unreachable", message, retryable: true })),
    );
    const url = "https://api.example.com/v1/secret-path?k={{credential:API_KEY}}";
    await expect(test.run(get(url))).resolves.toStrictEqual({
      ok: false,
      error: "request.unreachable",
    });
    const fields = { method: "GET", host: "api.example.com", errorCode: "request.unreachable" };
    expect(test.logger.records()).toStrictEqual([
      {
        level: "warn",
        subsystem: "engine.requests",
        event: "request.failed",
        fields: { ...fields, durationMs: 0 },
      },
    ]);
    const logged = JSON.stringify(test.logger.records());
    expect(logged).not.toContain(key);
    expect(logged).not.toContain("secret-path");
  });

  it("logs each request's method, host, status and time, never its path, query or headers", async () => {
    const test = await setUp();
    await test.run({
      method: "GET",
      url: "https://api.example.com/v1/accounts/42?key={{credential:API_KEY}}",
      headers: [{ name: "Authorization", value: "Bearer {{credential:API_KEY}}" }],
    });
    expect(test.logger.records().map(({ event, fields }) => ({ event, fields }))).toStrictEqual([
      {
        event: "request.sent",
        fields: { method: "GET", host: "api.example.com", status: 200, durationMs: 0 },
      },
    ]);
    const logged = JSON.stringify(test.logger.records());
    expect(logged).not.toContain(key);
    expect(logged).not.toContain("accounts");
  });

  it.each([
    ["http.private_address", "request.address_refused"],
    ["http.answer_too_large", "request.too_large"],
    ["http.proxy_unusable", "request.proxy_held"],
    ["http.no_route", "request.proxy_held"],
  ] as const)("answers the outbound code %s as %s", async (code, expected) => {
    const test = await setUp(async () =>
      Promise.reject(new BinferenceError({ code, message: "failed" })),
    );
    await expect(test.run(get("https://api.example.com/"))).resolves.toStrictEqual({
      ok: false,
      error: expected,
    });
  });

  it("answers an unreachable site for a fault of another kind", async () => {
    const test = await setUp(async () => Promise.reject(new Error(`socket ${key}`)));
    await expect(test.run(get("https://api.example.com/"))).resolves.toStrictEqual({
      ok: false,
      error: "request.unreachable",
    });
  });

  it("gives up at the request's time limit", async () => {
    const test = await setUp(
      async (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(request.signal.reason);
          });
        }),
    );
    const running = test.run({ ...get("https://api.example.com/slow"), timeoutSeconds: 5 });
    await test.clock.advance(5_000);
    await expect(running).resolves.toStrictEqual({ ok: false, error: "request.timed_out" });
  });

  it("throws the call's own abort, so the server answers it", async () => {
    const stop = new AbortController();
    const test = await setUp(async () => {
      stop.abort(new Error("engine stopping"));
      return Promise.reject(new Error("aborted"));
    });
    const args = { agent: testAgent, ...get("https://api.example.com/") };
    const call = { ...testCall(args, runtime), signal: stop.signal };
    await expect(test.handler(call)).rejects.toThrow("engine stopping");
  });

  it("answers only the runtime the engine runs now", async () => {
    const test = await setUp();
    await expect(test.run(get("https://api.example.com/"), testCallers.cli)).resolves.toStrictEqual(
      { ok: false, error: "auth.scope" },
    );
    expect(test.sent).toStrictEqual([]);
  });

  it("is unavailable in an engine that sends no requests", async () => {
    const turns = createRunningTurns();
    turns.startRuntime(idSchema("tok").parse(runtime.credential));
    const handler = createHttpRequestHandlers({ turns, clock: createManualClock(0) })[
      "http/request"
    ];
    await expect(
      handler(testCall({ agent: testAgent, ...get("https://api.example.com/") }, runtime)),
    ).resolves.toStrictEqual({ ok: false, error: "request.unavailable" });
  });
});
