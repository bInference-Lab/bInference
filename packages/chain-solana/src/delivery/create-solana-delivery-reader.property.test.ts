import type { AccountRef, AssetRef, TxHash } from "@binference/chain";
import { createManualClock } from "@binference/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSolanaRpcClient } from "../rpc/create-solana-rpc-client.js";
import type { SolanaChain } from "../solana-chain.js";
import { createFakeSolanaHttp } from "../testing/fake-solana-http.js";
import { createSolanaDeliveryReader } from "./create-solana-delivery-reader.js";

const cluster = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const chain = { ref: cluster, name: "Solana", nativeAsset: `${cluster}/slip44:501` } as SolanaChain;
const owner = "A9YsiCuAtY5RT3nfLKZTz2EuxxXf3FZogPqHkSH89SXT";
const other = "11111111111111111111111111111112";
const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const hash =
  "4QN4bPaaZguhX2hxpkabijEJcKZ4WpFn4TxTsGCVyuJd5ccSTGn6BN7aaowMjRjyzvy3gGWag75ouQPC6p7zDbu4" as TxHash;
const url = "https://node.invalid/";
const u64 = fc.bigInt({ min: 0n, max: 2n ** 64n - 1n });

/** One token account in a transaction's meta: its owner and what it held before and after. */
interface Holding {
  readonly isOwners: boolean;
  readonly before: bigint;
  readonly after: bigint;
}

const holding = fc.record({ isOwners: fc.boolean(), before: u64, after: u64 });

function balancesOf(holdings: readonly Holding[], pick: (item: Holding) => bigint) {
  return holdings.map((item, index) => ({
    accountIndex: index,
    mint,
    owner: item.isOwners ? owner : other,
    uiTokenAmount: { amount: pick(item).toString(), decimals: 6 },
  }));
}

// A getTransaction answer whose integers keep every digit: lamports past 2^53 among them.
function transactionBody(
  id: string,
  holdings: readonly Holding[],
  lamports: readonly [bigint, bigint],
): string {
  const meta = {
    err: null,
    preBalances: ["@0"],
    postBalances: ["@1"],
    preTokenBalances: balancesOf(holdings, ({ before }) => before),
    postTokenBalances: balancesOf(holdings, ({ after }) => after),
  };
  const result = { slot: 7, meta, transaction: { message: { accountKeys: [{ pubkey: owner }] } } };
  return JSON.stringify({ jsonrpc: "2.0", id, result })
    .replace('"@0"', lamports[0].toString())
    .replace('"@1"', lamports[1].toString());
}

function readerFor(holdings: readonly Holding[], lamports: readonly [bigint, bigint]) {
  const http = createFakeSolanaHttp({
    [url]: (_call, id) => ({
      status: 200,
      headers: {},
      body: transactionBody(id, holdings, lamports),
    }),
  });
  const rpc = createSolanaRpcClient({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
  });
  return createSolanaDeliveryReader({ rpc, chain });
}

const grew = (before: bigint, after: bigint): bigint => (after > before ? after - before : 0n);
const recipient = `${cluster}:${owner}` as AccountRef;
const usdc = `${cluster}/token:${mint}` as AssetRef;

describe("the Solana delivery reader's amounts", () => {
  it("reads a token as what the recipient's accounts hold after less before, never below 0", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(holding, { maxLength: 6 }), async (holdings) => {
        const sum = (pick: (item: Holding) => bigint): bigint =>
          holdings
            .filter(({ isOwners }) => isOwners)
            .reduce((total, item) => total + pick(item), 0n);
        const delivery = await readerFor(holdings, [0n, 0n]).delivery(
          { hash, recipient, asset: usdc },
          { signal: new AbortController().signal },
        );
        expect(delivery?.received.base).toBe(
          grew(
            sum(({ before }) => before),
            sum(({ after }) => after),
          ),
        );
      }),
      { numRuns: 50 },
    );
  });

  it("reads SOL as the recipient's lamports after less before, every digit kept", async () => {
    await fc.assert(
      fc.asyncProperty(u64, u64, async (before, after) => {
        const delivery = await readerFor([], [before, after]).delivery(
          { hash, recipient, asset: chain.nativeAsset },
          { signal: new AbortController().signal },
        );
        expect(delivery?.received.base).toBe(grew(before, after));
      }),
      { numRuns: 50 },
    );
  });
});
