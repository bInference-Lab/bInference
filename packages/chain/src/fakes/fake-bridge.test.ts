import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { bridgeContract } from "../contracts/bridge-contract.js";
import type { TxHash } from "../transaction.js";
import { createFakeBridge, fakeSettlementCases } from "./fake-bridge.js";
import { createFakeChainDefinition } from "./fake-chain.js";
import { fakeDraft } from "./fake-draft.js";

const source = chainRefSchema.parse(createFakeChainDefinition().id);
const wallet = accountRefSchema.parse(`${source}:0x000000a1`);
const spoke = accountRefSchema.parse(`${source}:0x000000e1`);
const usd = assetRefSchema.parse(`${source}/token:0x000000f1`);
const other = assetRefSchema.parse(`${source}/token:0x000000f2`);
const arrives = assetRefSchema.parse("fake:2/token:0x000000f3");
const recipient = accountRefSchema.parse("fake:2:0x000000b1");
const live = { signal: new AbortController().signal };
const request = {
  wallet,
  amountIn: { asset: usd, base: 1_000n },
  recipient,
  deliveredAsset: arrives,
  cappedAssets: [usd],
  contracts: { spoke },
};

const destination = chainRefSchema.parse("fake:2");
const hash = (text: string) => text as TxHash;
const deposit = (text: string) => ({ chain: source, hash: hash(text) });

// The fake building deposits of one kind, with a filled, a refunded and an expired deposit.
async function subjectOf(deposits: "bound" | "order") {
  const bridge = createFakeBridge({ routes: [{ leaves: usd, arrives }], deposits });
  const fill = { chain: destination, hash: hash("0xf1") };
  const refund = deposit("0xa2");
  bridge.settle(hash("0xd1"), { kind: "filled", fill });
  bridge.settle(hash("0xd2"), { kind: "refunded", refund });
  bridge.settle(hash("0xd3"), { kind: "expired" });
  return await Promise.resolve({
    bridge,
    request,
    unserved: { ...request, amountIn: { asset: other, base: 1_000n } },
    otherRecipient: accountRefSchema.parse("fake:2:0x000000b2"),
    deposits,
    filled: { deposit: deposit("0xd1"), fill },
    refunded: { deposit: deposit("0xd2"), refund },
    expired: deposit("0xd3"),
    unseen: deposit("0xe9"),
    ...fakeSettlementCases({ deposit: deposit("0xd1"), fill }, request),
  });
}

describe("fake bridge", () => {
  it.each(bridgeContract({ create: async () => subjectOf("bound") }))(
    "follows the contract with bound deposits: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it.each(bridgeContract({ create: async () => subjectOf("order") }))(
    "follows the contract with order deposits: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("answers no_route for a recipient on another chain than the delivered asset", async () => {
    const bridge = createFakeBridge({ routes: [{ leaves: usd, arrives }] });
    const elsewhere = accountRefSchema.parse(`${source}:0x000000b1`);
    expect(await bridge.quote({ ...request, recipient: elsewhere }, live)).toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it("refuses to build without its spoke, and decodes no deposit with a bad deadline", async () => {
    const bridge = createFakeBridge({ routes: [{ leaves: usd, arrives }] });
    const out = { asset: arrives, base: 990n };
    const quote = {
      expectedOut: out,
      minOut: out,
      fees: [],
      etaSeconds: 2,
      quotedAtMs: 0,
      expiresAtMs: 1,
    };
    const build = { ...request, contracts: {}, quote, minOut: out };
    await expect(bridge.build(build, live)).rejects.toMatchObject({ code: "venue.no_contract" });
    const data = `deposit,${recipient},1000,${usd},990,${arrives},soon`;
    const draft = fakeDraft(wallet, { to: "0x000000e1", value: 0n, data });
    expect(bridge.decode(draft)).toStrictEqual({ ok: false, error: "unknown_call" });
  });
});
