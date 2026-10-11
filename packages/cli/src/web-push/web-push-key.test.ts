import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { createSecret } from "@binference/core";
import { createMemorySecretStore } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { openWebPushKey, webPushKeyEntry } from "./web-push-key.js";

const live = (): AbortSignal => new AbortController().signal;

describe("the VAPID key", () => {
  it("is made once, kept in the store, and opened again as the same key", async () => {
    const store = createMemorySecretStore({});
    const made = await openWebPushKey(store, live());
    const point = Buffer.from(made.publicKey, "base64url");
    expect(point).toHaveLength(65);
    expect(point[0]).toBe(0x04);
    const stored = await store.read(webPushKeyEntry, live());
    expect(stored.ok).toBe(true);
    const opened = await openWebPushKey(store, live());
    expect(opened.publicKey).toBe(made.publicKey);
  });

  it.each([
    ["text that is no key", "not a key"],
    [
      "a key on another curve",
      generateKeyPairSync("ed25519")
        .privateKey.export({ format: "der", type: "pkcs8" })
        .toString("base64url"),
    ],
  ])("refuses an entry that holds %s", async (_, text) => {
    const store = createMemorySecretStore({});
    await store.write(webPushKeyEntry, createSecret(text), live());
    await expect(openWebPushKey(store, live())).rejects.toMatchObject({
      code: "web_push.key_unreadable",
    });
  });
});
