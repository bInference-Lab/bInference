import { BinferenceError } from "@binference/core";
import type { CustodyRecord, InstallFacts, SealKeyRecord } from "@binference/engine/install";
import { createP256KeyPair, formatOwnerKeyCode } from "@binference/signer";
import { describe, expect, it } from "vitest";
import { deriveSealingKey } from "../hpke/sealing-key.js";
import { ownerAuthorize } from "./owner-authorize.js";
import { createSealKeyKeeper } from "./seal-key-keeper.js";

const signal = (): AbortSignal => new AbortController().signal;

// An install whose custody names the owner key, and how many times its sealing key was set.
function installOf(ownerKeyPublic: string, options: { readonly isFaulty?: boolean } = {}) {
  const custody: CustodyRecord = {
    provider: "privy",
    appId: "app",
    ownerQuorumId: "owner-quorum",
    ownerKeyPublic,
    agentQuorumId: "agent-quorum",
    agentKeyPublic: "YWdlbnQ=",
    attachedAtMs: 1,
  };
  const held: { custody: CustodyRecord; sets: number } = { custody, sets: 0 };
  return {
    held,
    read: async (): Promise<InstallFacts> =>
      Promise.resolve({ custody: held.custody, wallets: [] }),
    setSealKey: async (key: SealKeyRecord) => {
      if (options.isFaulty === true) {
        throw new BinferenceError({ code: "store.busy", message: "Busy." });
      }
      held.custody = { ...held.custody, sealKeyPublic: key.sealKeyPublic };
      held.sets += 1;
      return Promise.resolve({ ok: true as const, value: undefined });
    },
  };
}

describe("the sealing key an install moves to", () => {
  it("is kept the first time the owner key signs a request, and only then", async () => {
    const owner = createP256KeyPair();
    const install = installOf(owner.publicKey);
    const keeper = createSealKeyKeeper(install);
    await keeper.refresh(signal());
    const holder = { ownerKeyPublic: async () => Promise.resolve(owner.publicKey), ...keeper };
    const code = formatOwnerKeyCode(owner);

    expect(keeper.isSealed()).toBe(false);
    expect((await ownerAuthorize(holder, code, signal())).ok).toBe(true);
    expect((await ownerAuthorize(holder, code, signal())).ok).toBe(true);

    expect(install.held.sets).toBe(1);
    expect(install.held.custody.sealKeyPublic).toBe(deriveSealingKey(owner.privateKey).publicKey);
    expect(keeper.isSealed()).toBe(true);
  });

  it("keeps nothing for a wrong owner key, and a store fault never stops the request", async () => {
    const owner = createP256KeyPair();
    const faulty = installOf(owner.publicKey, { isFaulty: true });
    const keeper = createSealKeyKeeper(faulty);
    const holder = { ownerKeyPublic: async () => Promise.resolve(owner.publicKey), ...keeper };
    const other = formatOwnerKeyCode(createP256KeyPair());

    const wrong = await ownerAuthorize(holder, other, signal());
    const right = await ownerAuthorize(holder, formatOwnerKeyCode(owner), signal());

    expect(wrong).toStrictEqual({ ok: false, error: "bad_owner_key" });
    expect(right.ok).toBe(true);
    expect(faulty.held.custody.sealKeyPublic).toBeUndefined();
  });
});
