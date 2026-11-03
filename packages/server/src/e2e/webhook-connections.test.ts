import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { hook, openRaw, postHead, ruleId, secret, startListener } from "./webhook-fixtures.js";

const opened: (() => Promise<void>)[] = [];

// The head of a POST that asks before it sends its body.
function expecting(path: string, length: number): string {
  return `${postHead(path, length).slice(0, -2)}Expect: 100-continue\r\n\r\n`;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (close) => close()));
});

// These run on Node's own timers: the listener's request timeout and the interval it checks it
// at are real time, so each limit here is short.
describe("the webhook listener's connections", () => {
  it("keeps serving after a sender closes in the middle of a body", async () => {
    const { port, post } = await startListener(opened);
    const cut = await openRaw(port, `${postHead(hook(ruleId, secret), 100)}{"id":"cu`);
    cut.socket.destroy();
    await cut.closed;
    await expect(post(hook(ruleId, secret))).resolves.toMatchObject({ status: 202 });
  });

  it("keeps serving after a body arrives slower than the request may take", async () => {
    const limits = { requestTimeoutMs: 300, checkIntervalMs: 100 };
    const { port, post } = await startListener(opened, { limits });
    const slow = await openRaw(port, `${postHead(hook(ruleId, secret), 100)}{"id"`);
    await slow.closed;
    expect(slow.received()).toMatch(/^HTTP\/1\.1 408 /);
    await expect(post(hook(ruleId, secret))).resolves.toMatchObject({ status: 202 });
  });

  it("closes cleanly when it stops while a body still arrives", async () => {
    const { port, listener, clock } = await startListener(opened);
    const held = await openRaw(port, `${postHead(hook(ruleId, secret), 100)}{"id"`);
    const closed = listener.close();
    await clock.advance(5_000);
    await expect(closed).resolves.toBeUndefined();
    await held.closed;
    expect(held.received()).toBe("");
  });

  it("cuts 64 idle connections within seconds, then takes an alert", async () => {
    const limits = { maxConnections: 64, requestTimeoutMs: 1_000, checkIntervalMs: 100 };
    const { port, post } = await startListener(opened, { limits });
    const began = performance.now();
    const idle = await Promise.all(Array.from({ length: 64 }, async () => openRaw(port)));
    await Promise.all(idle.map(async (connection) => connection.closed));
    expect(performance.now() - began).toBeLessThan(3_000);
    await expect(post(hook(ruleId, secret))).resolves.toMatchObject({ status: 202 });
  });

  it.each([
    ["a malformed rule id", hook("abc", secret)],
    ["a malformed secret", hook(ruleId, "short")],
    ["another path", "/upload/ticket-1"],
  ])("refuses %s from its request line, before any body", async (_name, path) => {
    const { port } = await startListener(opened);
    const asked = await openRaw(port, postHead(path, 1_000));
    await asked.closed;
    expect(asked.received()).toMatch(/^HTTP\/1\.1 404 /);
  });

  it("answers a sender that asks first: no 100 for a body over 16 KiB or a wrong path", async () => {
    const { port } = await startListener(opened);
    const large = await openRaw(port, expecting(hook(ruleId, secret), 16_385));
    const wrong = await openRaw(port, expecting(hook("abc", secret), 10));
    await Promise.all([large.closed, wrong.closed]);
    expect(large.received()).toMatch(/^HTTP\/1\.1 413 /);
    expect(wrong.received()).toMatch(/^HTTP\/1\.1 404 /);
  });

  it("tells a sender that asks first to send a body in bounds, then takes it", async () => {
    const { port } = await startListener(opened);
    const body = '{"id":"tv-1"}';
    const asking = await openRaw(port, expecting(hook(ruleId, secret), body.length));
    await asking.next("100 Continue");
    asking.socket.write(body);
    await asking.closed;
    expect(asking.received()).toMatch(/^HTTP\/1\.1 100 Continue\r\n\r\nHTTP\/1\.1 202 /);
  });
});
