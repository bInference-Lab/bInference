import { createManualClock } from "@binference/core/testing";
import type { PushFrame, Scope } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createPushHub, type PushHubOptions, type PushSubscriber } from "./push-hub.js";

const allScopes: readonly Scope[] = [
  "read",
  "propose",
  "chat",
  "agent",
  "confirm",
  "loosen",
  "admin",
];

function hubWith(options: Partial<PushHubOptions> = {}): ReturnType<typeof createPushHub> {
  return createPushHub({
    clock: createManualClock(0),
    maxPushesPerTopic: 1_000,
    pushRetentionMs: 600_000,
    maxTopics: 1_024,
    maxTopicsPerConnection: 64,
    ...options,
  });
}

function subscriber(
  id: string,
  scopes: readonly Scope[] = allScopes,
): PushSubscriber & {
  readonly received: PushFrame[];
} {
  const received: PushFrame[] = [];
  return { id, scopes, send: (push) => received.push(push), received };
}

const changed = (topic: "intent" | "order", n: number) =>
  ({ topic, kind: `${topic}/changed`, data: { n } }) as const;

describe("createPushHub", () => {
  it("numbers each topic's pushes from 1, apart from other topics", () => {
    const hub = hubWith();
    const seqs = [changed("intent", 1), changed("intent", 2), changed("order", 3)].map(
      (event) => hub.publish(event).seq,
    );
    expect(seqs).toStrictEqual([1, 2, 1]);
  });

  it("sends a push only to the subscribers of its topic", () => {
    const hub = hubWith();
    const one = subscriber("one");
    const two = subscriber("two");
    hub.subscribe(one, { intent: {} });
    hub.subscribe(two, { order: {} });
    hub.publish(changed("intent", 1));
    expect(one.received.map((push) => push.data)).toStrictEqual([{ n: 1 }]);
    expect(two.received).toStrictEqual([]);
  });

  it("answers a new subscription with the current seq and replays nothing", () => {
    const hub = hubWith();
    hub.publish(changed("intent", 1));
    expect(hub.subscribe(subscriber("one"), { intent: {}, order: {} })).toStrictEqual({
      ok: true,
      value: { view: { seqs: { intent: 1, order: 0 } }, replay: [] },
    });
  });

  it("replays the pushes from fromSeq in order", () => {
    const hub = hubWith();
    [1, 2, 3].forEach((n) => hub.publish(changed("intent", n)));
    expect(hub.subscribe(subscriber("one"), { intent: { fromSeq: 2 } })).toMatchObject({
      ok: true,
      value: { view: { seqs: { intent: 3 } }, replay: [{ seq: 2 }, { seq: 3 }] },
    });
  });

  it.each([
    {
      name: "older than the pushes kept",
      options: { maxPushesPerTopic: 2 },
      laterMs: 0,
      fromSeq: 1,
    },
    {
      name: "older than the time pushes are kept",
      options: { pushRetentionMs: 1_000 },
      laterMs: 1_001,
      fromSeq: 3,
    },
    { name: "past the current seq, as after a restart", options: {}, laterMs: 0, fromSeq: 9 },
  ])("asks for a resync when fromSeq is $name", async ({ options, laterMs, fromSeq }) => {
    const clock = createManualClock(0);
    const hub = hubWith({ ...options, clock });
    [1, 2, 3].forEach((n) => hub.publish(changed("intent", n)));
    await clock.advance(laterMs);
    expect(hub.subscribe(subscriber("one"), { intent: { fromSeq } })).toStrictEqual({
      ok: true,
      value: { view: { seqs: { intent: 3 }, resync: ["intent"] }, replay: [] },
    });
  });

  it.each([
    ["inbox without agent", "inbox", ["read"]],
    ["log without admin", "log", ["read", "confirm"]],
  ] as const)("refuses the topic %s", (_name, topic, scopes) => {
    const hub = hubWith();
    expect(hub.subscribe(subscriber("one", scopes), { [topic]: {} })).toStrictEqual({
      ok: false,
      error: "scope",
    });
  });

  it("lets read reach an agent's chat topic", () => {
    const hub = hubWith();
    const topic = "chat:agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
    expect(hub.subscribe(subscriber("one", ["read"]), { [topic]: {} }).ok).toBe(true);
  });

  it("refuses more topics than one connection may hold", () => {
    const hub = hubWith({ maxTopicsPerConnection: 1 });
    const one = subscriber("one");
    expect(hub.subscribe(one, { intent: {} }).ok).toBe(true);
    expect(hub.subscribe(one, { order: {} })).toStrictEqual({ ok: false, error: "busy" });
  });

  it("refuses a push to one more topic than it keeps", () => {
    const hub = hubWith({ maxTopics: 1 });
    hub.publish(changed("intent", 1));
    expect(() => hub.publish(changed("order", 1))).toThrow(
      expect.objectContaining({ code: "server.too_many_topics" }),
    );
  });

  it("refuses a push the push schema refuses", () => {
    const hub = hubWith();
    expect(() => hub.publish({ topic: "intent", kind: "Not A Kind", data: null })).toThrow(
      expect.objectContaining({ code: "server.bad_push" }),
    );
  });

  it("stops sending after an unsubscribe and after a drop", () => {
    const hub = hubWith();
    const one = subscriber("one");
    hub.subscribe(one, { intent: {}, order: {} });
    hub.unsubscribe("one", ["intent"]);
    hub.publish(changed("intent", 1));
    hub.publish(changed("order", 2));
    hub.drop("one");
    hub.publish(changed("order", 3));
    expect(one.received.map((push) => push.data)).toStrictEqual([{ n: 2 }]);
  });
});
