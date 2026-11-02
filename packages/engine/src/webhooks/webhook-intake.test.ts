import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryInboxStore } from "../fakes/memory-inbox-store.js";
import { createMemoryWebhookAlertStore } from "../fakes/memory-webhook-alert-store.js";
import { sha256Hex } from "../records/sha256-hex.js";
import type { WebhookAlertStore } from "./ports.js";
import type { WebhookRuleKey } from "./webhook-alert.js";
import { createWebhookIntake, type WebhookRequest } from "./webhook-intake.js";

const live = { signal: new AbortController().signal };
const now = 1_760_000_000_000;
const secret = "q3Zr_x9-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const body = new TextEncoder().encode('{"id":"tv-1"}');

function ruleOf(n: number, changes: Partial<WebhookRuleKey> = {}): WebhookRuleKey {
  return {
    id: fixtureId("whr", n),
    secretHash: sha256Hex(secret),
    state: "active",
    ratePerMinute: 1,
    ...changes,
  };
}

function setUp(rules: readonly WebhookRuleKey[]) {
  const inbox = createMemoryInboxStore();
  const store = createMemoryWebhookAlertStore({ inbox });
  rules.forEach((rule) => store.plant(rule));
  const calls: string[] = [];
  // Counts each call, so a test sees which reads and writes a request made.
  const counted: WebhookAlertStore = {
    findRule: async (id, call) => {
      calls.push("findRule");
      return store.findRule(id, call);
    },
    take: async (draft, call) => {
      calls.push("take");
      return store.take(draft, call);
    },
    prune: async (beforeMs, call) => store.prune(beforeMs, call),
  };
  const clock = createManualClock(now);
  const intake = createWebhookIntake({ store: counted, clock });
  const take = async (request: Partial<WebhookRequest> = {}) =>
    intake.take({ ruleId: fixtureId("whr", 1), secret, body, ...request }, live);
  return { inbox, store, calls, clock, take };
}

describe("the webhook intake", () => {
  it("accepts an alert of an active rule into the inbox before it answers", async () => {
    const { take, inbox } = setUp([ruleOf(1)]);
    await expect(take()).resolves.toBe("accepted");
    const entries = await inbox.unhandled({ keyPrefix: "wh:", limit: 10 }, live);
    expect(entries.map((entry) => entry.payload)).toStrictEqual([
      { rule: fixtureId("whr", 1), event: 1, alertId: "tv-1", body: { text: '{"id":"tv-1"}' } },
    ]);
  });

  it("answers a wrong secret and an unknown rule alike, after the same one read", async () => {
    const { take, calls, inbox } = setUp([ruleOf(1)]);
    await expect(take({ secret: `${secret.slice(0, -1)}8` })).resolves.toBe("not_found");
    const wrongSecret = [...calls];
    calls.length = 0;
    await expect(take({ ruleId: fixtureId("whr", 2) })).resolves.toBe("not_found");
    expect(calls).toStrictEqual(wrongSecret);
    expect(wrongSecret).toStrictEqual(["findRule"]);
    expect(await inbox.unhandled({ keyPrefix: "wh:", limit: 10 }, live)).toStrictEqual([]);
  });

  it.each([
    ["awaiting its card", ruleOf(1, { state: "awaiting_confirmation" })],
    ["deleted", ruleOf(1, { state: "deleted" })],
    ["expired", ruleOf(1, { expiresAtMs: now })],
  ])("answers not found for a rule %s, with the right secret", async (_name, rule) => {
    const { take, calls } = setUp([rule]);
    await expect(take()).resolves.toBe("not_found");
    expect(calls).toStrictEqual(["findRule"]);
  });

  it("answers not found for a path that is no rule id, reading nothing", async () => {
    const { take, calls } = setUp([ruleOf(1)]);
    await expect(take({ ruleId: "ord_0190f1c2-3a4b-7c5d-8e6f-000000000001" })).resolves.toBe(
      "not_found",
    );
    await expect(take({ ruleId: "../ws" })).resolves.toBe("not_found");
    expect(calls).toStrictEqual([]);
  });

  it("answers a repeat, then the rate, then accepts once the windows pass", async () => {
    const { take, clock } = setUp([ruleOf(1)]);
    await expect(take()).resolves.toBe("accepted");
    await expect(take()).resolves.toBe("repeat");
    const other = new TextEncoder().encode('{"id":"tv-2"}');
    await expect(take({ body: other })).resolves.toBe("rate");
    await clock.advance(60_000);
    await expect(take({ body: other })).resolves.toBe("accepted");
    await expect(take()).resolves.toBe("repeat");
    await clock.advance(539_999);
    await expect(take()).resolves.toBe("repeat");
    await clock.advance(1);
    await expect(take()).resolves.toBe("accepted");
  });

  it("accepts a plain-text body, stores it, and takes the same text again as a repeat", async () => {
    const { take, inbox } = setUp([ruleOf(1, { ratePerMinute: 60 })]);
    const text = new TextEncoder().encode("BNBUSDT crossed 600");
    await expect(take({ body: text })).resolves.toBe("accepted");
    await expect(take({ body: text })).resolves.toBe("repeat");
    await expect(take({ body: text, secret: "wrong" })).resolves.toBe("not_found");
    const bytes = new Uint8Array([0xff, 0xfe, 0x01]);
    await expect(take({ body: bytes })).resolves.toBe("accepted");
    const entries = await inbox.unhandled({ keyPrefix: "wh:", limit: 10 }, live);
    expect(entries.map((entry) => entry.payload)).toStrictEqual([
      { rule: fixtureId("whr", 1), event: 1, body: { text: "BNBUSDT crossed 600" } },
      { rule: fixtureId("whr", 1), event: 3, body: { base64: "//4B" } },
    ]);
  });

  it("answers not found when the rule's URL changed after the read", async () => {
    const { take, store } = setUp([ruleOf(1)]);
    const rotating: WebhookAlertStore = {
      ...store,
      findRule: async (id, call) => {
        const found = await store.findRule(id, call);
        store.plant(ruleOf(1, { secretHash: sha256Hex("a new secret") }));
        return found;
      },
    };
    const intake = createWebhookIntake({ store: rotating, clock: createManualClock(now) });
    const request = { ruleId: fixtureId("whr", 1), secret, body };
    await expect(intake.take(request, live)).resolves.toBe("not_found");
    await expect(take()).resolves.toBe("not_found");
  });
});
