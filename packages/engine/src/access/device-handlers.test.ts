import { err } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryAccessStore } from "../fakes/memory-access-store.js";
import { expectOk, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { consolePairCodeHash, consolePairLifetimeMs } from "./console-pair-code.js";
import { createDeviceHandlers } from "./device-handlers.js";

const origin = "http://127.0.0.1:7456";

function devices(options: { readonly consoleOrigin?: string } = { consoleOrigin: origin }) {
  const clock = createManualClock(testNowMs);
  const access = createMemoryAccessStore();
  const random = createSeededRandom(3);
  const handlers = createDeviceHandlers({
    access,
    clock,
    random,
    consoleOrigin: () => options.consoleOrigin,
  });
  return { access, clock, handlers };
}

const laptop = {
  id: fixtureId("dev", 1),
  label: "Laptop",
  alg: "ed25519",
  publicKey: "MCowBQYDK2VwAyEA",
  createdAtMs: 5,
} as const;

describe("the device handlers", () => {
  it("answers a console link whose code pairs once within 10 minutes", async () => {
    const { access, handlers } = devices();
    const pairing = expectOk(await handlers["device/pair"](testCall({})));
    const link = new URL(pairing.link);
    expect(link.origin).toBe(origin);
    expect(link.pathname).toBe("/");
    const code = link.hash.replace(/^#pair=/, "");
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(pairing.expiresAt).toBe(testNowMs + consolePairLifetimeMs);
    const use = { codeHash: consolePairCodeHash(code), atMs: testNowMs };
    expect(await access.usePairCode(use, testCall({}))).toMatchObject({ ok: true });
  });

  it("makes no code while the HTTP listener is not bound", async () => {
    const { handlers } = devices({});
    await expect(handlers["device/pair"](testCall({}))).rejects.toMatchObject({
      code: "engine.no_console",
    });
  });

  it("lists devices without their keys and revokes one, keeping the first time", async () => {
    const { access, clock, handlers } = devices();
    await access.addDevice(laptop, testCall({}));
    expect(
      expectOk(await handlers["device/revoke"](testCall({ device: laptop.id }))),
    ).toStrictEqual({});
    await clock.advance(1_000);
    await handlers["device/revoke"](testCall({ device: laptop.id }));
    expect(expectOk(await handlers["device/list"](testCall({})))).toStrictEqual({
      items: [
        { device: laptop.id, label: "Laptop", alg: "ed25519", createdAt: 5, revokedAt: testNowMs },
      ],
    });
  });

  it("refuses to revoke a device it does not know", async () => {
    const { handlers } = devices();
    await expect(
      handlers["device/revoke"](testCall({ device: fixtureId("dev", 9) })),
    ).resolves.toStrictEqual(err("protocol.bad_args"));
  });
});
