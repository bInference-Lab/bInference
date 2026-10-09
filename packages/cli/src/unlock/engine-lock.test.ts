import { createSecret, err, ok, type Result, type Secret } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createEngineLock } from "./engine-lock.js";
import type { LockReason, UnlockedKeys } from "./unlock-keys.js";

const keys: UnlockedKeys = {
  agentKey: createSecret("agent key text"),
  agentPublicKey: "public half",
  appSecret: createSecret("app secret"),
};
const passphrase = "correct horse battery staple";
const signal = new AbortController().signal;

// Opens the keys only with the passphrase, and counts every read.
function sealed() {
  const reads: (string | undefined)[] = [];
  const handed: UnlockedKeys[] = [];
  const lock = createEngineLock({
    open: async (call): Promise<Result<UnlockedKeys, LockReason>> => {
      const typed = call.passphrase?.reveal();
      reads.push(typed);
      if (typed === undefined) {
        return Promise.resolve(err("needs_passphrase"));
      }
      return Promise.resolve(typed === passphrase ? ok(keys) : err("wrong_passphrase"));
    },
    onUnlocked: async (opened) => {
      handed.push(opened);
      return Promise.resolve();
    },
  });
  return { lock, reads, handed };
}

const given = (typed?: string): { readonly passphrase?: Secret; readonly signal: AbortSignal } =>
  typed === undefined ? { signal } : { passphrase: createSecret(typed), signal };

describe("the engine lock", () => {
  it("starts locked and stays locked with the reason until the keys open", async () => {
    const { lock, handed } = sealed();
    expect(lock.isLocked()).toBe(true);
    await expect(lock.unlock(given())).resolves.toStrictEqual(err("needs_passphrase"));
    await expect(lock.unlock(given("wrong"))).resolves.toStrictEqual(err("wrong_passphrase"));
    expect([lock.isLocked(), handed]).toStrictEqual([true, []]);
  });

  it("hands the keys over once, then answers every later unlock without reading", async () => {
    const { lock, reads, handed } = sealed();
    await expect(lock.unlock(given(passphrase))).resolves.toStrictEqual(ok(undefined));
    await expect(lock.unlock(given("anything"))).resolves.toStrictEqual(ok(undefined));
    expect([lock.isLocked(), reads, handed]).toStrictEqual([false, [passphrase], [keys]]);
  });

  it("runs unlocks one at a time, so the keys are handed over once", async () => {
    const { lock, handed } = sealed();
    const both = await Promise.all([
      lock.unlock(given(passphrase)),
      lock.unlock(given(passphrase)),
    ]);
    expect(both).toStrictEqual([ok(undefined), ok(undefined)]);
    expect(handed).toHaveLength(1);
  });

  it("stays locked when the step that takes the keys fails", async () => {
    const lock = createEngineLock({
      open: async () => Promise.resolve(ok(keys)),
      onUnlocked: async () => Promise.reject(new Error("The signer did not start.")),
    });
    await expect(lock.unlock(given())).rejects.toThrow("The signer did not start.");
    expect(lock.isLocked()).toBe(true);
  });
});
