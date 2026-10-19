import { assetRefSchema, isTxHash, type TxHash } from "@binference/chain";
import { type Address, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { erc20AssetRef, type EvmChain } from "../evm-chain.js";
import type { BlockFacts, BlockTransaction } from "./chain-block.schema.js";
import { type TradeContext, tradeGroupsOf, tradesOf, withNativeReceived } from "./match-trades.js";
import type { WalletTransfer } from "./wallet-transfers.js";

const chain: EvmChain = {
  ref: "eip155:56" as EvmChain["ref"],
  chainId: 56,
  name: "Test chain",
  nativeAsset: assetRefSchema.parse("eip155:56/slip44:714"),
  nativeSymbol: "BNB",
  nativeDecimals: 18,
};

function addressOf(prefix: string, n: number): Address {
  return getAddress(`0x${prefix}${n.toString(16).padStart(40 - prefix.length, "0")}`);
}

function hashOf(n: number): TxHash {
  const hash = `0x${n.toString(16).padStart(64, "0")}`;
  if (!isTxHash(hash)) {
    throw new Error("Not a hash.");
  }
  return hash;
}

const wallet = addressOf("1a", 1);
const [alpha, beta, usdt, wbnb] = [1, 2, 3, 4].map((n) => addressOf("2b", n));
const router = addressOf("4d", 1);
const context: TradeContext = {
  chain,
  quotes: new Set([
    chain.nativeAsset,
    ...[usdt, wbnb].map((token) => erc20AssetRef(chain, token ?? router)),
  ]),
  venues: new Map([[router, "kyberswap"]]),
};
const ref = (token: Address | undefined) => erc20AssetRef(chain, token ?? router);

// A transfer of the wallet: its transaction, log index, token and delta.
function transfer(given: readonly [number, number, Address | undefined, bigint]): WalletTransfer {
  const [tx, logIndex, token, delta] = given;
  return {
    account: wallet,
    block: 7n,
    txHash: hashOf(tx),
    logIndex,
    token: token ?? router,
    delta,
  };
}

function facts(transactions: readonly BlockTransaction[]): BlockFacts {
  return {
    number: 7n,
    hash: `0x${"70".repeat(32)}`,
    parentHash: `0x${"69".repeat(32)}`,
    timestampMs: 7_000,
    transactions,
  };
}

const sent = (tx: number, value = 0n, to: Address = router): BlockTransaction => ({
  hash: hashOf(tx),
  from: wallet,
  to,
  value,
});

describe("trades of a block", () => {
  it("reads one token for another as a sale of the first and a buy of the second", () => {
    const transfers = [transfer([1, 3, alpha, -50n]), transfer([1, 5, beta, 80n])];
    const groups = tradeGroupsOf(context, transfers, facts([sent(1)]));
    expect(tradesOf(context, groups)).toMatchObject([
      {
        side: "sell",
        asset: ref(alpha),
        amount: 50n,
        counterAsset: ref(beta),
        counterAmount: 80n,
        logIndex: 3,
        soldToken: alpha,
      },
      {
        side: "buy",
        asset: ref(beta),
        amount: 80n,
        counterAsset: ref(alpha),
        counterAmount: 50n,
        logIndex: 5,
      },
    ]);
  });

  it("reads one quote asset for another as a buy of the one received, and a token for USDT as a sale", () => {
    const transfers = [
      transfer([1, 0, usdt, -10n]),
      transfer([1, 1, wbnb, 3n]),
      transfer([2, 2, alpha, -9n]),
      transfer([2, 4, usdt, 2n]),
    ];
    const groups = tradeGroupsOf(context, transfers, facts([sent(1), sent(2)]));
    expect(tradesOf(context, groups).map(({ side, asset }) => [side, asset])).toStrictEqual([
      ["buy", ref(wbnb)],
      ["sell", ref(alpha)],
    ]);
  });

  it("reads no trade from a transfer, an airdrop, or two tokens out for one in", () => {
    const transfers = [
      transfer([1, 0, alpha, -10n]),
      transfer([2, 1, beta, 10n]),
      transfer([3, 2, alpha, -1n]),
      transfer([3, 3, usdt, -1n]),
      transfer([3, 4, beta, 1n]),
      transfer([4, 5, alpha, 6n]),
      transfer([4, 6, alpha, -6n]),
    ];
    const groups = tradeGroupsOf(context, transfers, facts([sent(1, 0n, wallet), sent(3)]));
    expect(tradesOf(context, groups)).toStrictEqual([]);
  });

  it("shares the coin a block paid between two sales at a venue, the rest to the first, and leaves a plain transfer out", () => {
    const transfers = [
      transfer([1, 0, alpha, -10n]),
      transfer([2, 1, beta, -20n]),
      transfer([3, 2, alpha, -5n]),
    ];
    const block = facts([sent(1), sent(2), sent(3, 0n, addressOf("6f", 1))]);
    const groups = tradeGroupsOf(context, transfers, block);
    const paid = withNativeReceived(context, groups, new Map([[wallet, 101n]]));
    expect(
      tradesOf(context, paid).map(({ asset, counterAmount }) => [asset, counterAmount]),
    ).toStrictEqual([
      [ref(alpha), 51n],
      [ref(beta), 50n],
    ]);
  });

  it("reads a sale at a venue for an unmeasured coin at 0, and nothing for one elsewhere or with no coin paid", () => {
    const transfers = [transfer([1, 0, alpha, -10n]), transfer([2, 1, beta, -3n])];
    const block = facts([sent(1), sent(2, 0n, addressOf("6f", 1))]);
    const groups = tradeGroupsOf(context, transfers, block);
    const unknown = withNativeReceived(context, groups, new Map([[wallet, "unknown"]]));
    expect(tradesOf(context, unknown)).toMatchObject([
      {
        side: "sell",
        asset: ref(alpha),
        counterAsset: chain.nativeAsset,
        counterAmount: 0n,
        venue: "kyberswap",
      },
    ]);
    const none = withNativeReceived(context, groups, new Map([[wallet, 0n]]));
    expect(tradesOf(context, none)).toStrictEqual([]);
  });

  it("reads USDT for the coin as a buy of the coin, at no venue, keyed by the USDT log", () => {
    const transfers = [transfer([1, 6, usdt, -10n])];
    const elsewhere = addressOf("6f", 2);
    const groups = tradeGroupsOf(context, transfers, facts([sent(1, 0n, elsewhere)]));
    const paid = withNativeReceived(context, groups, new Map([[wallet, 4n]]));
    expect(tradesOf(context, paid)).toStrictEqual([
      {
        account: wallet,
        txHash: hashOf(1),
        logIndex: 6,
        side: "buy",
        asset: chain.nativeAsset,
        amount: 4n,
        counterAsset: ref(usdt),
        counterAmount: 10n,
      },
    ]);
  });

  it("reads no sale for an unmeasured coin away from every venue", () => {
    const transfers = [transfer([1, 0, alpha, -10n])];
    const groups = tradeGroupsOf(context, transfers, facts([sent(1, 0n, addressOf("6f", 1))]));
    const unknown = withNativeReceived(context, groups, new Map([[wallet, "unknown"]]));
    expect(tradesOf(context, unknown)).toStrictEqual([]);
  });
});
