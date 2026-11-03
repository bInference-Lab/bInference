import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { maxWebhookBodyBytes } from "../webhook-listener.js";
import { type LocalAnswer, requestLocal } from "./local-http.js";
import { openRawSocket } from "./raw-socket.js";
import {
  hook,
  type ListenerOptions,
  ruleId,
  secret,
  startListener,
  unknownRule,
} from "./webhook-fixtures.js";

const opened: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (close) => close()));
});

const start = async (options: ListenerOptions = {}) => startListener(opened, options);
const wrongSecret = `${secret.slice(0, -1)}8`;

// What an answer shows a sender, without the time it was sent.
function shown(answer: LocalAnswer) {
  const { date: _date, ...headers } = answer.headers;
  return { status: answer.status, headers, body: answer.body };
}

function padded(size: number): string {
  return `{"id":"big","pad":"${"x".repeat(size - 21)}"}`;
}

async function timed(send: () => Promise<LocalAnswer>): Promise<number> {
  const began = performance.now();
  await send();
  return performance.now() - began;
}

interface PairTimes {
  readonly wrong: readonly number[];
  readonly unknown: readonly number[];
}

// Sends a wrong secret, then an unknown rule, `rounds` times, one request at a time, so a change
// in the machine's load reaches both alike, and keeps each answer's time in milliseconds.
async function timePairs(
  post: (path: string) => Promise<LocalAnswer>,
  rounds: number,
): Promise<PairTimes> {
  const empty: PairTimes = { wrong: [], unknown: [] };
  return Array.from({ length: rounds }).reduce<Promise<PairTimes>>(async (previous) => {
    const times = await previous;
    const wrong = await timed(async () => post(hook(ruleId, wrongSecret)));
    const unknown = await timed(async () => post(hook(unknownRule, secret)));
    return { wrong: [...times.wrong, wrong], unknown: [...times.unknown, unknown] };
  }, Promise.resolve(empty));
}

const unset = (): void => undefined;

// Settles only when the signal aborts, as a store write that hangs does.
async function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

// A promise the test resolves when it chooses.
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = unset;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe("the webhook listener", () => {
  it("accepts an alert once it is in the inbox, with an empty 202", async () => {
    const { post, alerts } = await start();
    const answer = await post(hook(ruleId, secret));
    expect(shown(answer)).toMatchObject({ status: 202, body: "" });
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect((await alerts()).map((entry) => entry.payload)).toStrictEqual([
      { rule: ruleId, event: 1, alertId: "tv-1", body: { text: '{"id":"tv-1"}' } },
    ]);
  });

  it("answers only after the alert is stored", async () => {
    const gate = deferred();
    const taking = deferred();
    const { post, alerts } = await start({
      store: (store) => ({
        ...store,
        take: async (draft, call) => {
          taking.resolve();
          await gate.promise;
          return store.take(draft, call);
        },
      }),
    });
    const answered: number[] = [];
    const answer = post(hook(ruleId, secret)).then((sent) => {
      answered.push(sent.status);
      return sent;
    });
    await taking.promise;
    expect(answered).toStrictEqual([]);
    expect(await alerts()).toStrictEqual([]);
    gate.resolve();
    await expect(answer).resolves.toMatchObject({ status: 202 });
    expect(await alerts()).toHaveLength(1);
  });

  it("answers a wrong secret and an unknown rule with the same 404, and stores nothing", async () => {
    const { post, alerts } = await start();
    const wrong = shown(await post(hook(ruleId, wrongSecret)));
    const unknown = shown(await post(hook(unknownRule, secret)));
    expect(wrong).toStrictEqual(unknown);
    expect(wrong).toMatchObject({ status: 404, body: "" });
    expect(await alerts()).toStrictEqual([]);
  });

  it("answers a wrong secret and an unknown rule in the same time band", async () => {
    const { post } = await start();
    const { wrong, unknown } = await timePairs(post, 120);
    // The first rounds warm the sockets and the code paths; the medians of the rest are compared.
    const [wrongMs, unknownMs] = [median(wrong.slice(10)), median(unknown.slice(10))];
    const band = Math.max(0.5, 0.25 * Math.max(wrongMs, unknownMs));
    expect(Math.abs(wrongMs - unknownMs)).toBeLessThanOrEqual(band);
  });

  it("answers a repeat id or body within ten minutes with 409", async () => {
    const { post, alerts, clock } = await start();
    await expect(post(hook(ruleId, secret))).resolves.toMatchObject({ status: 202 });
    const repeatId = await post(hook(ruleId, secret), '{"id":"tv-1","price":"601"}');
    expect(repeatId.status).toBe(409);
    await clock.advance(60_000);
    const sameBody = await post(hook(ruleId, secret), '{"id":"tv-1"}');
    expect(sameBody.status).toBe(409);
    await clock.advance(540_000);
    await expect(post(hook(ruleId, secret))).resolves.toMatchObject({ status: 202 });
    expect(await alerts()).toHaveLength(2);
  });

  it("answers 429 past the rule's rate in any 60 seconds", async () => {
    const { post, alerts, clock } = await start();
    const statuses = async (ids: readonly string[]) =>
      Promise.all(
        ids.map(async (id) => (await post(hook(ruleId, secret), `{"id":"${id}"}`)).status),
      );
    await expect(statuses(["a", "b", "c"])).resolves.toStrictEqual([202, 202, 429]);
    await clock.advance(60_000);
    await expect(statuses(["c"])).resolves.toStrictEqual([202]);
    expect(await alerts()).toHaveLength(3);
  });

  it("reads a body of 16 KiB and refuses one byte more with 413", async () => {
    const { post, alerts } = await start();
    expect(padded(maxWebhookBodyBytes)).toHaveLength(maxWebhookBodyBytes);
    await expect(
      post(hook(ruleId, secret), padded(maxWebhookBodyBytes + 1)),
    ).resolves.toMatchObject({
      status: 413,
    });
    await expect(post(hook(ruleId, secret), padded(maxWebhookBodyBytes))).resolves.toMatchObject({
      status: 202,
    });
    expect(await alerts()).toHaveLength(1);
  });

  it("accepts a plain-text alert with its body, and answers its repeat with 409", async () => {
    const { post, alerts } = await start();
    const text = "BNBUSDT crossed 600";
    await expect(post(hook(ruleId, wrongSecret), text)).resolves.toMatchObject({ status: 404 });
    await expect(post(hook(ruleId, secret), text)).resolves.toMatchObject({ status: 202 });
    await expect(post(hook(ruleId, secret), text)).resolves.toMatchObject({ status: 409 });
    expect((await alerts()).map((entry) => entry.payload)).toStrictEqual([
      { rule: ruleId, event: 1, body: { text } },
    ]);
  });

  it.each([
    ["the console", "GET", "/"],
    ["the Mini App", "GET", "/mini"],
    ["health", "GET", "/health"],
    ["pairing", "POST", "/pair"],
    ["an upload", "POST", "/upload/ticket-1"],
    ["a download", "GET", "/file/ticket-1"],
    ["the WebSocket path", "GET", "/ws"],
    ["the route with GET", "GET", hook(ruleId, secret)],
    ["a longer path", "POST", `${hook(ruleId, secret)}/more`],
    ["a dot segment", "POST", `/hook/x/../${ruleId}/${secret}`],
    ["an encoded slash", "POST", `/hook/${ruleId}%2F${secret}`],
  ])("serves none of the engine's routes: %s gets the same 404", async (_name, method, path) => {
    const { port, post, alerts } = await start();
    const unknown = shown(await post(hook(unknownRule, secret)));
    const answer = await requestLocal(port, { path, method, body: '{"id":"tv-1"}' });
    expect(shown(answer)).toStrictEqual(unknown);
    expect(await alerts()).toStrictEqual([]);
  });

  it("refuses a WebSocket upgrade with 404", async () => {
    const { port } = await start();
    await expect(openRawSocket(`ws://127.0.0.1:${String(port)}/ws`)).rejects.toThrow("404");
  });

  it("answers 503 when storing the alert outlasts its time", async () => {
    const { post } = await start({
      limits: { takeTimeoutMs: 50 },
      store: (store) => ({ ...store, take: async (_draft, call) => waitForAbort(call.signal) }),
    });
    await expect(post(hook(ruleId, secret))).resolves.toMatchObject({ status: 503 });
  });

  it("answers 503 when the alert cannot be stored, and logs no path", async () => {
    const { post, logger } = await start({
      store: (store) => ({
        ...store,
        take: async () => Promise.reject(new Error("the database is closed")),
      }),
    });
    await expect(post(hook(ruleId, secret))).resolves.toMatchObject({ status: 503 });
    const logged = JSON.stringify(logger.records());
    expect(logged).toContain("webhook.take_failed");
    expect(logged).not.toContain(secret);
  });

  it("lets an alert under way finish when it closes, then cuts what outlasts the grace", async () => {
    const gate = deferred();
    const taking = deferred();
    const { post, listener, clock } = await start({
      store: (store) => ({
        ...store,
        take: async (draft, call) => {
          taking.resolve();
          await gate.promise;
          return store.take(draft, call);
        },
      }),
    });
    const finished = post(hook(ruleId, secret));
    await taking.promise;
    const closed = listener.close();
    gate.resolve();
    await expect(finished).resolves.toMatchObject({ status: 202 });
    await clock.advance(5_000);
    await expect(closed).resolves.toBeUndefined();
  });

  it("binds loopback only and takes nothing once closed", async () => {
    const { port, listener, post } = await start();
    await listener.close();
    await expect(post(hook(ruleId, secret))).rejects.toThrow("ECONNREFUSED");
    await expect(listener.close()).resolves.toBeUndefined();
    expect(port).toBeGreaterThan(0);
  });
});
