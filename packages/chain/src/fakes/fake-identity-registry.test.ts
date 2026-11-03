import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { identityRegistryContract } from "../contracts/identity-registry-contract.js";
import type { TxHash } from "../transaction.js";
import { fakeDraft } from "./fake-draft.js";
import { createFakeIdentityRegistry } from "./fake-identity-registry.js";

const chain = chainRefSchema.parse("fake:1");
const wallet = accountRefSchema.parse("fake:1:0x000000a1");
const other = accountRefSchema.parse("fake:1:0x000000a2");
const live = { signal: new AbortController().signal };
const card = { name: "Scout", description: "", wallet, version: "2026.11.3" };
const unknownHash = "fake-identity-404" as TxHash;

function registryAt() {
  return createFakeIdentityRegistry({ chain, address: "0x000000e1" });
}

describe("fake identity registry", () => {
  it.each(
    identityRegistryContract({
      create: async () => {
        const registry = registryAt();
        return await Promise.resolve({
          registry,
          wallet,
          other,
          foreign: fakeDraft(wallet, { to: "0x000000f1", value: 0n, data: "register,data%3A" }),
          simulate: async (draft) => Promise.resolve(registry.simulate(draft)),
          land: async (draft) => Promise.resolve(registry.land(draft)),
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a call that sends coin or carries more words, and reverts its simulation", () => {
    const registry = registryAt();
    const paying = fakeDraft(wallet, { to: "0x000000e1", value: 1n, data: "register,data%3A" });
    const longer = fakeDraft(wallet, { to: "0x000000e1", value: 0n, data: "register,a,b" });
    expect([registry.decode(paying).ok, registry.decode(longer).ok]).toStrictEqual([false, false]);
    expect(registry.simulate(paying)).toMatchObject({ status: "reverted", logs: [] });
    expect(() => registry.land(paying)).toThrow(/another call/);
  });

  it("counts an identity made outside, reports a new version, and goes down until up", async () => {
    const registry = registryAt();
    registry.registerOutside(wallet);
    registry.setVersion("3.0.0");
    await expect(registry.standing(wallet, live)).resolves.toStrictEqual({
      version: "3.0.0",
      held: 1n,
    });
    registry.down();
    await expect(registry.standing(wallet, live)).rejects.toMatchObject({ code: "chain.rpc_down" });
    await expect(registry.landed({ wallet, txHash: unknownHash }, live)).rejects.toThrow(/down/);
    registry.up();
    await expect(registry.landed({ wallet, txHash: unknownHash }, live)).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("reads back a tampered identity as it is now, and refuses a card of another chain", async () => {
    const registry = registryAt();
    const txHash = registry.land(registry.build({ wallet, file: registry.fileOf(card) }));
    registry.tamper("0", { owner: other, file: "data:,moved" });
    registry.tamper("9", { owner: other });
    await expect(registry.landed({ wallet, txHash }, live)).resolves.toStrictEqual({
      ok: true,
      value: { onchainId: "0", owner: other, file: "data:,moved" },
    });
    const foreign = accountRefSchema.parse("fake:2:0x000000a1");
    expect(() => registry.fileOf({ ...card, wallet: foreign })).toThrow(/another chain/);
  });
});
