import { afterEach, describe, expect, it } from "vitest";
import { hook, openRaw, postHead, ruleId, secret, startListener } from "./webhook-fixtures.js";

const opened: (() => Promise<void>)[] = [];

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
});
