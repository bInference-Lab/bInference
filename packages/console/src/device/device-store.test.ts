import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeviceKey, signWith } from "./device-key";
import { createIndexedDeviceStore, type StoredDevice } from "./device-store";

const { subtle } = globalThis.crypto;

// IndexedDB answers on the next task, which the fake IndexedDB queues with setImmediate: leave
// that one real, keep the rest of time fake.
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
});

afterEach(() => {
  vi.useFakeTimers();
});

describe("the device store", () => {
  it("keeps the device key as a CryptoKey that still signs and never exports", async () => {
    const factory = new IDBFactory();
    const key = await createDeviceKey(subtle);
    const device = { deviceId: "dev_1", alg: key.alg, privateKey: key.privateKey };
    await createIndexedDeviceStore(factory).save(device);
    const loaded = await createIndexedDeviceStore(factory).load();
    expect(loaded?.deviceId).toBe("dev_1");
    expect(loaded?.privateKey.extractable).toBe(false);
    const signer = loaded as StoredDevice;
    await expect(signWith(subtle, signer, "text")).resolves.toMatch(/^[\w-]{86}$/);
  });

  it("has no device before a pairing and none after it forgets", async () => {
    const store = createIndexedDeviceStore(new IDBFactory());
    await expect(store.load()).resolves.toBeUndefined();
    const key = await createDeviceKey(subtle);
    await store.save({ deviceId: "dev_2", alg: key.alg, privateKey: key.privateKey });
    await store.forget();
    await expect(store.load()).resolves.toBeUndefined();
  });
});
