import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { nonceSourceContract } from "../contracts/nonce-source-contract.js";
import { receiptReaderContract } from "../contracts/receipt-reader-contract.js";
import { type RelayBehavior, relaySenderContract } from "../contracts/relay-sender-contract.js";
import { txPreparerContract } from "../contracts/tx-preparer-contract.js";
import type { TxDraft, TxHash } from "../transaction.js";
import { fakeDraft } from "./fake-draft.js";
import { createFakeNetwork, type FakeNetwork } from "./fake-network.js";
import { fakeTxHash, signFake } from "./fake-signing-scheme.js";

const chain = chainRefSchema.parse("fake:1");
const nonceSchema = z.coerce.number().pipe(z.int());
const account = accountRefSchema.parse("fake:1:0x0000000c");
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const swap = fakeDraft(account, { to: "0x0000000b", value: 5n, data: "swap" });
const broken = fakeDraft(account, { to: "0x0000000b", value: 0n, data: "broken" });

const coin = assetRefSchema.parse("fake:1/slip44:1");
const swapTransfers = [{ from: account, to: chainAccount(11), amount: { asset: coin, base: 5n } }];

function networkOf(options: { readonly feeCapBase?: bigint } = {}): FakeNetwork {
  return createFakeNetwork({
    chain,
    clock: createManualClock(1_000),
    reverting: [broken.payload],
    transfers: (sent) => (sent.draftPayload === swap.payload ? swapTransfers : []),
    ...options,
  });
}

// Prepares, signs and sends a draft at a nonce, as the wallet queue does.
async function sendDraft(network: FakeNetwork, draft: TxDraft, nonce: number) {
  const { signed } = await preparedSigned(network, draft, nonce);
  return { signed, answers: await network.send(signed, live()) };
}

async function hashOf(network: FakeNetwork, draft: TxDraft, nonce: number): Promise<TxHash> {
  const { signed } = await sendDraft(network, draft, nonce);
  network.mine();
  return fakeTxHash(signed.raw) as TxHash;
}

async function senderSubject(behaviors: readonly RelayBehavior[]) {
  const relays = behaviors.map((_, index) => `relay-${String(index)}`);
  const network = createFakeNetwork({ chain, clock: createManualClock(1_000), relays });
  behaviors.forEach((behavior, index) => {
    network.script(`relay-${String(index)}`, behavior);
  });
  const { signed } = await preparedSigned(network, swap, 0);
  return { sender: network, signed, received: () => network.received() };
}

async function preparedSigned(network: FakeNetwork, draft: TxDraft, nonce: number) {
  const prepared = await network.prepare({ draft, nonce }, live());
  if (!prepared.ok) {
    throw new Error("Expected the draft to prepare.");
  }
  return { signed: signFake(prepared.value.unsigned, "0x0000000c") };
}

describe("fake network", () => {
  describe("as a relay sender", () => {
    it.each(relaySenderContract({ create: async (behaviors) => senderSubject(behaviors) }))(
      "follows the contract: $name",
      async ({ run }) => {
        await expect(run()).resolves.toBeUndefined();
      },
    );
  });

  describe("as a receipt reader", () => {
    it.each(
      receiptReaderContract({
        create: async () => {
          const network = networkOf();
          const succeeded = await hashOf(network, swap, 0);
          const reverted = await hashOf(network, broken, 1);
          return {
            reader: network,
            chain,
            succeeded,
            succeededTransfers: swapTransfers,
            reverted,
            unknown: "fake00000000" as TxHash,
            sender: account,
          };
        },
      }),
    )("follows the contract: $name", async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    });
  });

  describe("as a transaction preparer", () => {
    it.each(
      txPreparerContract({
        create: async (feeCapBase) => {
          const network = networkOf({ feeCapBase });
          network.failing(broken.payload);
          return await Promise.resolve({
            preparer: network,
            draft: swap,
            failing: broken,
            nonceOf: (unsigned) => nonceSchema.parse(unsigned.payload.split("|")[3]),
          });
        },
      }),
    )("follows the contract: $name", async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    });
  });

  describe("as a nonce source", () => {
    it.each(
      nonceSourceContract({
        create: async () => {
          const network = networkOf();
          await sendDraft(network, swap, 0);
          network.mine();
          return { source: network, known: { account, next: 1 }, unseen: chainAccount(13) };
        },
      }),
    )("follows the contract: $name", async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    });
  });

  it("mines a transaction only once every lower nonce of its sender is in a block", async () => {
    const network = networkOf();
    const later = await sendDraft(network, swap, 1);
    network.mine();
    expect(await network.next(account, live())).toBe(0);
    await sendDraft(network, broken, 0);
    network.mine();
    expect(await network.next(account, live())).toBe(2);
    expect(later.answers.map((answer) => answer.outcome)).toStrictEqual(["accepted", "accepted"]);
  });

  it("refuses a transaction at a nonce a block holds, and finalizes blocks behind the head", async () => {
    const network = networkOf();
    await sendDraft(network, swap, 0);
    network.mine(4);
    const again = await sendDraft(network, broken, 0);
    expect(again.answers.map((answer) => answer.outcome)).toStrictEqual(["refused", "refused"]);
    await expect(network.head(chain, live())).resolves.toStrictEqual({ latest: 4n, final: 2n });
  });

  it("takes a transaction out of its block in a reorg, and mines it again later", async () => {
    const network = networkOf();
    const hash = await hashOf(network, swap, 0);
    network.reorg(hash);
    await expect(network.receipt(chain, hash, live())).resolves.toBeUndefined();
    expect(await network.next(account, live())).toBe(0);
    network.mine();
    await expect(network.receipt(chain, hash, live())).resolves.toMatchObject({
      block: { number: 2n },
    });
    network.reorg("fake00000000" as TxHash);
  });

  it("reads no transfers when the test names none, and counts nonces block by block", async () => {
    const network = createFakeNetwork({ chain, clock: createManualClock(1_000) });
    const hash = await hashOf(network, swap, 0);
    await expect(network.transfers(chain, hash, live())).resolves.toStrictEqual([]);
    await expect(network.nonceAt(chainAccount(13), 1n, live())).resolves.toBe(0);
  });

  it("fails the reads a test sets to fail, then reads again", async () => {
    const network = networkOf();
    network.failReads(2);
    const outcomes = await Promise.allSettled([
      network.head(chain, live()),
      network.receipt(chain, "fake00000000" as TxHash, live()),
    ]);
    expect(outcomes).toMatchObject([
      { status: "rejected", reason: { code: "chain.rpc_down" } },
      { status: "rejected", reason: { code: "chain.rpc_down" } },
    ]);
    await expect(network.head(chain, live())).resolves.toStrictEqual({ latest: 0n, final: 0n });
  });

  it("serves one chain, reads only its own bytes, and lets a failing draft run again", async () => {
    const network = networkOf();
    const other = chainRefSchema.parse("fake:2");
    await expect(network.head(other, live())).rejects.toMatchObject({
      code: "chain.unknown_chain",
    });
    const unreadable = ["fake-signed|x", "fake-signed|0x0000000c|0x0000000b|0|x|1e2|5"];
    const sends = unreadable.map(async (raw) => network.send({ chain, raw }, live()));
    const outcomes = await Promise.allSettled(sends);
    expect(outcomes).toMatchObject([
      { status: "rejected", reason: { code: "chain.bad_transaction" } },
      { status: "rejected", reason: { code: "chain.bad_transaction" } },
    ]);
    network.failing(swap.payload);
    await expect(network.prepare({ draft: swap, nonce: 0 }, live())).resolves.toStrictEqual({
      ok: false,
      error: "would_fail",
    });
    network.passing(swap.payload);
    network.setFeePerGas(10n ** 12n);
    const prepared = await network.prepare({ draft: swap, nonce: 0 }, live());
    expect(prepared).toMatchObject({ ok: true, value: { isAboveFeeCap: true } });
    expect(network.sends()).toBe(2);
  });
});

function chainAccount(n: number) {
  return accountRefSchema.parse(`fake:1:0x${n.toString(16).padStart(8, "0")}`);
}
