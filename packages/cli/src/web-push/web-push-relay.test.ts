import { type HttpRequest, idSchema, type JsonValue } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createMemorySecretStore,
  createScriptedHttp,
  createSeededRandom,
} from "@binference/core/testing";
import { createMemoryAccessStore } from "@binference/engine/testing";
import { messages } from "@binference/i18n";
import type { OwnerInfo } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createTestReceiver } from "./test-receiver.js";
import { openWebPushKey } from "./web-push-key.js";
import { createWebPushRelay } from "./web-push-relay.js";

const nowMs = 1_790_000_000_000;
const device = idSchema("dev").parse("dev_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const card = "crd_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const browser = createTestReceiver();

const answers = { sent: 201, gone: 410, failing: 500 } as const;
type Endpoint = keyof typeof answers;
const urlOf = (name: string): string => `https://push.example.invalid/${name}`;

async function relayOn(options: { readonly owner?: OwnerInfo; readonly staleKey?: boolean } = {}) {
  const key = await openWebPushKey(createMemorySecretStore({}), live().signal);
  const access = createMemoryAccessStore();
  await access.addDevice(
    { id: device, label: "Laptop", alg: "ed25519", publicKey: "MCow", createdAtMs: 1 },
    live(),
  );
  const serverKey = options.staleKey === true ? "B".repeat(87) : key.publicKey;
  for (const [n, name] of Object.keys(answers).entries()) {
    const subscription = { endpoint: urlOf(name), deviceId: device, ...browser.keys };
    // oxlint-disable-next-line eslint/no-await-in-loop -- the rows keep the order they were saved in
    await access.saveWebPushSubscription({ ...subscription, serverKey, createdAtMs: n }, live());
  }
  const http = createScriptedHttp(
    Object.entries(answers).map(([name, status]) => ({
      method: "POST" as const,
      url: urlOf(name),
      response: { status, headers: {}, body: "" },
    })),
  );
  const logger = createMemoryLogger({ subsystem: "web_push" });
  const relay = createWebPushRelay({
    subscriptions: access,
    key,
    http,
    owner: () => options.owner ?? { locale: "en", timezone: "UTC" },
    clock: createManualClock(nowMs),
    random: createSeededRandom(4),
    logger,
  });
  return { relay, http, access, logger, key };
}

function opened(expiresAt: number) {
  return {
    topic: "intent",
    kind: "card/opened",
    data: { intent, card, version: 1, expiresAt },
  } as const;
}

const closed = {
  topic: "intent",
  kind: "card/closed",
  data: { intent, card, reason: "confirmed" },
} as const;

function sentTo(requests: readonly HttpRequest[], name: Endpoint): HttpRequest | undefined {
  return requests.find((request) => request.url === urlOf(name));
}

function headersOf(request: HttpRequest | undefined): Readonly<Record<string, string>> {
  return request?.headers ?? {};
}

function messageOf(request: HttpRequest | undefined): JsonValue {
  return browser.openJson(request?.bodyBytes);
}

describe("the browser push relay", () => {
  it("sends an opened card to each browser, encrypted, signed and kept for the card's time", async () => {
    const { relay, http, key } = await relayOn();
    relay.relay(opened(nowMs + 60_000));
    await relay.idle();
    const request = sentTo(http.requests(), "sent");
    const headers = headersOf(request);
    expect(headers).toMatchObject({ ttl: "60", urgency: "high", "content-encoding": "aes128gcm" });
    expect(headers["authorization"]).toMatch(new RegExp(`^vapid t=.+, k=${key.publicKey}$`));
    expect(headers["topic"]).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(messageOf(request)).toStrictEqual({
      v: 1,
      kind: "opened",
      intent,
      card,
      title: "A card waits for your answer",
      body: "Open the console to read it, then confirm or cancel.",
    });
  });

  it("sends a closed card under the same topic, at normal urgency, in the owner's language", async () => {
    const { relay, http } = await relayOn({ owner: { locale: "zh", timezone: "Asia/Shanghai" } });
    relay.relay(opened(nowMs + 60_000));
    relay.relay(closed);
    await relay.idle();
    const [open, close] = http.requests().filter((request) => request.url === urlOf("sent"));
    expect(close?.headers).toMatchObject({ ttl: "600", urgency: "normal" });
    expect(close?.headers?.["topic"]).toBe(open?.headers?.["topic"]);
    expect(messageOf(close)).toStrictEqual({
      v: 1,
      kind: "closed",
      intent,
      card,
      title: messages.zh["webPush.closed.title"],
      body: messages.zh["webPush.closed.body"],
    });
  });

  it("drops a subscription its push service says is gone and keeps one it refused", async () => {
    const { relay, access, logger } = await relayOn();
    relay.relay(opened(nowMs + 60_000));
    await relay.idle();
    const kept = await access.listWebPushSubscriptions(live());
    expect(kept.map((subscription) => subscription.endpoint)).toStrictEqual([
      urlOf("sent"),
      urlOf("failing"),
    ]);
    const events = logger
      .records()
      .map((record) => `${record.event} ${String(record.fields.errorCode)}`);
    // The browsers are sent to at once, so their lines come in either order.
    expect(events.toSorted()).toStrictEqual([
      "web_push.gone_dropped http.410",
      "web_push.refused http.500",
    ]);
  });

  it("drops a subscription made for another key without sending to it", async () => {
    const { relay, access, http } = await relayOn({ staleKey: true });
    relay.relay(opened(nowMs + 60_000));
    await relay.idle();
    expect(http.requests()).toStrictEqual([]);
    await expect(access.listWebPushSubscriptions(live())).resolves.toStrictEqual([]);
  });

  it("leaves every other push alone and sends nothing once closed", async () => {
    const { relay, http } = await relayOn();
    relay.relay({ topic: "intent", kind: "intent/changed", data: { intent } });
    relay.relay({ topic: "intent", kind: "card/opened", data: { intent: 5 } });
    await relay.close();
    relay.relay(opened(nowMs + 60_000));
    await relay.idle();
    expect(http.requests()).toStrictEqual([]);
  });
});
