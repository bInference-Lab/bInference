import type { ProtocolClient } from "@binference/client";
import { describe, expect, it } from "vitest";
import { bytesOfBase64url } from "../device/base64url";
import { type BrowserPush, readPushSetting, turnPushOff, turnPushOn } from "./browser-push";

// The keys of RFC 8292's and RFC 8291's worked examples.
const engineKey =
  "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs";
const otherKey =
  "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const p256dh =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const auth = "BTBZMqHH6r4Tts7J_aSIgg";
const endpoint = "https://push.example.invalid/send/a";

/** A browser's push subscription that keeps whether it was ended. */
function subscription(serverKey: string) {
  const state = { ended: false };
  const keys: Readonly<Record<string, string>> = { p256dh, auth };
  const made = {
    endpoint,
    options: { applicationServerKey: bytesOfBase64url(serverKey).buffer },
    getKey: (name: string) => bytesOfBase64url(keys[name] ?? "").buffer,
    unsubscribe: async () => {
      state.ended = true;
      return true;
    },
  } as unknown as PushSubscription;
  return { made, state };
}

function browserWith(options: {
  readonly permission?: NotificationPermission;
  readonly answer?: NotificationPermission;
  readonly held?: PushSubscription;
}) {
  const subscribed: PushSubscriptionOptionsInit[] = [];
  const fresh = subscription(engineKey).made;
  const manager = {
    getSubscription: async () => options.held ?? null,
    subscribe: async (asked: PushSubscriptionOptionsInit) => {
      subscribed.push(asked);
      return fresh;
    },
  } as unknown as PushManager;
  const push: BrowserPush = {
    permission: () => options.permission ?? "default",
    requestPermission: async () => options.answer ?? "granted",
    manager: async () => manager,
  };
  return { push, subscribed };
}

function engine({ registered }: { readonly registered: boolean }) {
  const calls: [string, object][] = [];
  const client = {
    call: async (op: string, args: object) => {
      calls.push([op, args]);
      return op === "webPush/status" ? { publicKey: engineKey, registered } : {};
    },
  } as unknown as ProtocolClient;
  return { client, calls };
}

const signal = new AbortController().signal;
const registration = [
  "webPush/register",
  { subscription: { endpoint, keys: { p256dh, auth } } },
] as const;

describe("browser push in the console", () => {
  it("reads blocked, off, and on for a subscription the engine holds", async () => {
    const { client, calls } = engine({ registered: true });
    const blocked = browserWith({ permission: "denied" });
    await expect(readPushSetting({ push: blocked.push, client, signal })).resolves.toStrictEqual({
      kind: "blocked",
    });
    const none = browserWith({});
    await expect(readPushSetting({ push: none.push, client, signal })).resolves.toStrictEqual({
      kind: "off",
    });
    const held = browserWith({ held: subscription(engineKey).made });
    await expect(readPushSetting({ push: held.push, client, signal })).resolves.toStrictEqual({
      kind: "on",
    });
    expect(calls.map(([op]) => op)).toStrictEqual(["webPush/status", "webPush/status"]);
  });

  it("registers again a subscription the engine lost, and ends one made for another key", async () => {
    const lost = engine({ registered: false });
    const held = browserWith({ held: subscription(engineKey).made });
    await readPushSetting({ push: held.push, client: lost.client, signal });
    expect(lost.calls.at(-1)).toStrictEqual(registration);
    const old = subscription(otherKey);
    const moved = browserWith({ held: old.made });
    const setting = await readPushSetting({
      push: moved.push,
      client: engine({ registered: true }).client,
      signal,
    });
    expect({ setting, ended: old.state.ended }).toStrictEqual({
      setting: { kind: "off" },
      ended: true,
    });
  });

  it("turns on with the engine's key once the owner allows it", async () => {
    const { client, calls } = engine({ registered: false });
    const { push, subscribed } = browserWith({});
    await expect(turnPushOn({ push, client, signal })).resolves.toStrictEqual({ kind: "on" });
    expect(subscribed).toStrictEqual([
      { userVisibleOnly: true, applicationServerKey: bytesOfBase64url(engineKey) },
    ]);
    expect(calls.at(-1)).toStrictEqual(registration);
  });

  it("stays off when the owner does not allow it", async () => {
    const { client, calls } = engine({ registered: false });
    const refused = browserWith({ permission: "denied", answer: "denied" });
    await expect(turnPushOn({ push: refused.push, client, signal })).resolves.toStrictEqual({
      kind: "blocked",
    });
    const dismissed = browserWith({ answer: "default" });
    await expect(turnPushOn({ push: dismissed.push, client, signal })).resolves.toStrictEqual({
      kind: "off",
    });
    expect(calls).toStrictEqual([]);
  });

  it("turns off: the engine drops the subscription, then the browser ends it", async () => {
    const { client, calls } = engine({ registered: true });
    const held = subscription(engineKey);
    const { push } = browserWith({ held: held.made });
    await expect(turnPushOff({ push, client, signal })).resolves.toStrictEqual({ kind: "off" });
    expect({ calls, ended: held.state.ended }).toStrictEqual({
      calls: [["webPush/unregister", { endpoint }]],
      ended: true,
    });
  });
});
