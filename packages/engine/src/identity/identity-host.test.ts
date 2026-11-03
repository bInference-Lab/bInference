import { accountRefSchema, type TxHash } from "@binference/chain";
import type { IdentityRegistry } from "@binference/chain/identity";
import { describe, expect, it } from "vitest";
import { testAccount } from "../operations/test-engine.js";
import { createIdentityHost } from "./identity-host.js";
import { testRegistry } from "./test-identities.js";

const live = { signal: new AbortController().signal };
const other = accountRefSchema.parse("fake:1:0x000000f9");
const file = "data:application/json,%7B%7D";
const hash = "fake-identity-0" as TxHash;

function broken(change: Partial<IdentityRegistry>): IdentityRegistry {
  return { ...testRegistry(), ...change };
}

const fault = (): never => {
  throw new Error("The plugin failed.");
};

describe("the identity host", () => {
  it("reads a standing, and a plugin that throws or answers outside its shape as venue_down", async () => {
    const host = createIdentityHost([]);
    const registry = testRegistry();
    await expect(host.standing(registry, testAccount, live)).resolves.toStrictEqual({
      ok: true,
      value: { version: "2.0.0", held: 0n, implementation: "fake:1:0x000000e6" },
    });
    const throwing = broken({ standing: async () => Promise.reject(new Error("down")) });
    const shapeless = broken({
      standing: async () => Promise.resolve({ version: "", held: -1n }),
    });
    await expect(host.standing(throwing, testAccount, live)).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
    await expect(host.standing(shapeless, testAccount, live)).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("holds a build to its file and wallet, and refuses one that drifts or throws", () => {
    const host = createIdentityHost([]);
    const registry = testRegistry();
    const draft = registry.build({ wallet: testAccount, file });
    expect(host.build(registry, { wallet: testAccount, file })).toStrictEqual({
      ok: true,
      value: draft,
    });
    const drifting = broken({ build: () => registry.build({ wallet: other, file }) });
    const throwing = broken({ build: fault, decode: fault, minted: fault });
    const refused = { ok: false, error: "decode_mismatch" };
    expect(host.build(drifting, { wallet: testAccount, file })).toStrictEqual(refused);
    expect(host.build(registry, { wallet: testAccount, file: "not a data uri" })).toStrictEqual(
      refused,
    );
    expect(host.build(throwing, { wallet: testAccount, file })).toStrictEqual(refused);
    expect(host.holds(throwing, draft, { wallet: testAccount, file })).toBe(false);
    expect(host.minted(throwing, registry.simulate(draft), testAccount)).toBe(0);
  });

  it("reads a landing back, not found, down, or outside its shape", async () => {
    const host = createIdentityHost([]);
    const registry = testRegistry();
    const landed = registry.land(registry.build({ wallet: testAccount, file }));
    await expect(
      host.landed(registry, { wallet: testAccount, txHash: landed }, live),
    ).resolves.toStrictEqual({
      ok: true,
      value: { onchainId: "0", owner: testAccount, file },
    });
    await expect(
      host.landed(registry, { wallet: other, txHash: hash }, live),
    ).resolves.toStrictEqual({ ok: false, error: "not_found" });
    const shapeless = broken({
      landed: async () =>
        Promise.resolve({ ok: true, value: { onchainId: "01", owner: testAccount, file } }),
    });
    await expect(
      host.landed(shapeless, { wallet: testAccount, txHash: hash }, live),
    ).resolves.toStrictEqual({ ok: false, error: "venue_down" });
    registry.down();
    await expect(
      host.landed(registry, { wallet: testAccount, txHash: hash }, live),
    ).resolves.toStrictEqual({ ok: false, error: "venue_down" });
  });

  it("names the registry it runs on a chain and the calls it declares", () => {
    const registry = testRegistry();
    const host = createIdentityHost([registry]);
    expect(host.registryOn(registry.chain)).toBe(registry);
    expect(host.registryOn(accountRefSchema.parse("fake:2:0x01").slice(0, 6) as never)).toBe(
      undefined,
    );
    expect(host.callsOf(registry)).toMatchObject([{ name: "register" }]);
  });
});
