import {
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  type TxDraft,
  type TxHash,
} from "@binference/chain";
import {
  createFakeNetwork,
  createFakeSigningScheme,
  type FakeNetwork,
  fakeDraft,
  receiptReaderContract,
  signFake,
} from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { notingReceipts } from "./noting-receipts.js";

const chain = chainRefSchema.parse("fake:1");
const account = accountRefSchema.parse("fake:1:0x0000000c");
const payee = accountRefSchema.parse("fake:1:0x0000000b");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const swap = fakeDraft(account, { to: "0x0000000b", value: 5n, data: "swap" });
const broken = fakeDraft(account, { to: "0x0000000b", value: 0n, data: "broken" });
const swapTransfers = [{ from: account, to: payee, amount: { asset: coin, base: 5n } }];

function networkOf(): FakeNetwork {
  return createFakeNetwork({
    chain,
    clock: createManualClock(1_000),
    reverting: [broken.payload],
    transfers: (sent) => (sent.draftPayload === swap.payload ? swapTransfers : []),
    nativeReceived: (sent) => (sent.draftPayload === swap.payload ? 7n : 0n),
  });
}

// Prepares, signs, sends and mines a draft at a nonce, and answers its hash.
async function hashOf(network: FakeNetwork, draft: TxDraft, nonce: number): Promise<TxHash> {
  const prepared = await network.prepare({ draft, nonce }, live());
  if (!prepared.ok) {
    throw new Error("Expected the draft to prepare.");
  }
  const signed = signFake(prepared.value.unsigned, "0x0000000c");
  await network.send(signed, live());
  network.mine();
  const hash = createFakeSigningScheme().verify(prepared.value.unsigned, signed);
  if (!hash.ok) {
    throw new Error("Expected the fake scheme to hash the transaction.");
  }
  return hash.value;
}

describe("a receipt reader that notes the heads it reads", () => {
  it.each(
    receiptReaderContract({
      create: async () => {
        const network = networkOf();
        network.mine();
        const succeeded = await hashOf(network, swap, 0);
        const reverted = await hashOf(network, broken, 1);
        network.forgetStateBelow(1n);
        return {
          reader: notingReceipts(network, []),
          chain,
          succeeded,
          succeededTransfers: swapTransfers,
          reverted,
          unknown: "fake00000000" as TxHash,
          sender: account,
          nativeReceived: 7n,
          stateGone: 1n,
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("notes the latest block of each head it reads", async () => {
    const network = networkOf();
    network.mine();
    network.mine();
    const heads: bigint[] = [];
    const head = await notingReceipts(network, heads).head(chain, live());
    expect(heads).toStrictEqual([head.latest]);
  });
});
