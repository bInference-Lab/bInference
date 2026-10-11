import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryAccessStore } from "../fakes/memory-access-store.js";
import { expectOk, testNowMs } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import { createWebPushHandlers } from "./web-push-handlers.js";

// The keys of RFC 8292's and RFC 8291's worked examples.
const publicKey =
  "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs";
const keys = {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};
const endpoint = "https://push.example.invalid/send/a";

function device(n: number) {
  return {
    id: fixtureId("dev", n),
    label: `Laptop ${String(n)}`,
    alg: "ed25519",
    publicKey: "MCowBQYDK2VwAyEA",
    createdAtMs: 5,
  } as const;
}

function deviceCaller(n: number): EngineCaller {
  return {
    credential: device(n).id,
    client: { kind: "console", version: "test" },
    scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
    transport: "ws",
  };
}

async function webPush(key = publicKey) {
  const access = createMemoryAccessStore();
  await access.addDevice(device(1), testCall({}));
  await access.addDevice(device(2), testCall({}));
  const clock = createManualClock(testNowMs);
  return { access, handlers: createWebPushHandlers({ access, clock, publicKey: key }) };
}

describe("the browser push handlers", () => {
  it("registers the calling device's subscription with the key it was made for", async () => {
    const { access, handlers } = await webPush();
    const call = testCall({ subscription: { endpoint, keys } }, deviceCaller(1));
    expect(expectOk(await handlers["webPush/register"](call))).toStrictEqual({});
    expect(await access.listWebPushSubscriptions(testCall({}))).toStrictEqual([
      { endpoint, deviceId: device(1).id, ...keys, serverKey: publicKey, createdAtMs: testNowMs },
    ]);
    const status = await handlers["webPush/status"](testCall({}, deviceCaller(1)));
    expect(expectOk(status)).toStrictEqual({ publicKey, registered: true });
    const other = await handlers["webPush/status"](testCall({}, deviceCaller(2)));
    expect(expectOk(other)).toStrictEqual({ publicKey, registered: false });
  });

  it("counts a subscription made for another key as none", async () => {
    const { access, handlers } = await webPush("B".repeat(87));
    const old = { endpoint, deviceId: device(1).id, ...keys, serverKey: publicKey, createdAtMs: 1 };
    await access.saveWebPushSubscription(old, testCall({}));
    const status = await handlers["webPush/status"](testCall({}, deviceCaller(1)));
    expect(expectOk(status)).toMatchObject({ registered: false });
  });

  it("drops only the calling device's own subscription", async () => {
    const { access, handlers } = await webPush();
    await handlers["webPush/register"](
      testCall({ subscription: { endpoint, keys } }, deviceCaller(1)),
    );
    const foreign = await handlers["webPush/unregister"](testCall({ endpoint }, deviceCaller(2)));
    expect(expectOk(foreign)).toStrictEqual({});
    expect(await access.listWebPushSubscriptions(testCall({}))).toHaveLength(1);
    await handlers["webPush/unregister"](testCall({ endpoint }, deviceCaller(1)));
    expect(await access.listWebPushSubscriptions(testCall({}))).toStrictEqual([]);
  });

  it("refuses a revoked device and any caller that is no console device", async () => {
    const { access, handlers } = await webPush();
    await access.revokeDevice({ id: device(1).id, atMs: 1 }, testCall({}));
    const subscription = { endpoint, keys };
    await expect(
      handlers["webPush/register"](testCall({ subscription }, deviceCaller(1))),
    ).resolves.toStrictEqual({ ok: false, error: "auth.revoked" });
    await expect(
      handlers["webPush/register"](testCall({ subscription }, testCallers.cli)),
    ).resolves.toStrictEqual({ ok: false, error: "auth.device_only" });
    await expect(
      handlers["webPush/unregister"](testCall({ endpoint }, testCallers.cli)),
    ).resolves.toStrictEqual({ ok: false, error: "auth.device_only" });
    const status = await handlers["webPush/status"](testCall({}, testCallers.cli));
    expect(expectOk(status)).toStrictEqual({ publicKey, registered: false });
  });
});
