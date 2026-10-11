import { generateKeyPairSync } from "node:crypto";
import { createIdSource, err } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { createMemoryAccessStore } from "../fakes/memory-access-store.js";
import { expectOk, testNowMs } from "../intents/test-intents.js";
import type { EnginePush } from "../pushes/engine-push.js";
import {
  consolePairCodeHash,
  consolePairLifetimeMs,
  issueConsolePairCode,
} from "./console-pair-code.js";
import { deviceKeyObject } from "./device-key.js";
import { createDevicePairing, newDeviceNoticeKey } from "./device-pairing.js";

const live = { signal: new AbortController().signal };

function spkiOf(kind: "ed25519" | "p256"): string {
  const pair =
    kind === "ed25519"
      ? generateKeyPairSync("ed25519")
      : generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
}

async function pairing() {
  const clock = createManualClock(testNowMs);
  const random = createSeededRandom(5);
  const access = createMemoryAccessStore();
  const pushes: EnginePush[] = [];
  const ids = createIdSource({ clock, random });
  const devices = createDevicePairing({ access, clock, ids, publish: (push) => pushes.push(push) });
  const { code } = await issueConsolePairCode({ access, clock, random }, live);
  return { access, clock, devices, pushes, code };
}

describe("console pairing codes", () => {
  it("stores only the code's hash, valid for 10 minutes", async () => {
    const access = createMemoryAccessStore();
    const clock = createManualClock(testNowMs);
    const issued = await issueConsolePairCode(
      { access, clock, random: createSeededRandom(1) },
      live,
    );
    expect(issued.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(issued.expiresAtMs).toBe(testNowMs + consolePairLifetimeMs);
    const use = { codeHash: consolePairCodeHash(issued.code), atMs: testNowMs };
    expect(await access.usePairCode(use, live)).toMatchObject({ ok: true });
  });

  it("hashes a console code apart from the same text as a Telegram start code", () => {
    expect(consolePairCodeHash("abc")).not.toBe(consolePairCodeHash("abd"));
    expect(consolePairCodeHash("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("device keys", () => {
  it("parses an Ed25519 and a P-256 key under the scheme each names", () => {
    expect(deviceKeyObject({ alg: "ed25519", publicKey: spkiOf("ed25519") })).toBeDefined();
    expect(deviceKeyObject({ alg: "p256", publicKey: spkiOf("p256") })).toBeDefined();
  });

  it("refuses a key of the other scheme and text that is no key", () => {
    expect(deviceKeyObject({ alg: "p256", publicKey: spkiOf("ed25519") })).toBeUndefined();
    expect(deviceKeyObject({ alg: "ed25519", publicKey: spkiOf("p256") })).toBeUndefined();
    expect(deviceKeyObject({ alg: "ed25519", publicKey: "bm90LWEta2V5" })).toBeUndefined();
  });
});

describe("device pairing", () => {
  it("pairs a device once with its code and tells every surface its label", async () => {
    const { access, devices, pushes, code } = await pairing();
    const publicKey = spkiOf("ed25519");
    const request = { code, publicKey, alg: "ed25519", label: "Laptop" } as const;
    const { device } = expectOk(await devices.pair(request, live));
    expect(await access.findDevice(device, live)).toStrictEqual({
      id: device,
      label: "Laptop",
      alg: "ed25519",
      publicKey,
      createdAtMs: testNowMs,
    });
    expect(pushes).toStrictEqual([
      {
        topic: "notice",
        kind: "notice/new",
        data: { key: newDeviceNoticeKey, values: { label: "Laptop" } },
      },
    ]);
    await expect(devices.pair(request, live)).resolves.toStrictEqual(err("auth.invalid"));
  });

  it("refuses an expired code and an unknown one", async () => {
    const { clock, devices, code } = await pairing();
    const request = { code, publicKey: spkiOf("p256"), alg: "p256", label: "Phone" } as const;
    await expect(devices.pair({ ...request, code: "unknown" }, live)).resolves.toStrictEqual(
      err("auth.invalid"),
    );
    await clock.advance(consolePairLifetimeMs);
    await expect(devices.pair(request, live)).resolves.toStrictEqual(err("auth.expired"));
  });

  it("refuses a key that does not parse before it uses the code", async () => {
    const { devices, code, pushes } = await pairing();
    const request = { code, publicKey: spkiOf("p256"), alg: "ed25519", label: "Tab" } as const;
    await expect(devices.pair(request, live)).resolves.toStrictEqual(err("protocol.bad_args"));
    expectOk(await devices.pair({ ...request, alg: "p256" }, live));
    expect(pushes).toHaveLength(1);
  });

  it("says in English that a device was paired", () => {
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    expect(english.message(newDeviceNoticeKey, { label: "Laptop" })).toBe(
      "A new console device was paired: Laptop",
    );
  });
});
