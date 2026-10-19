import type { AccountRef, AssetRef, TxHash } from "@binference/chain";
import { type Bps, bpsPerWhole, bpsSchema, type Ratio } from "@binference/core";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { type EvmChain, evmAccountRef } from "../evm-chain.js";
import type { BlockHeader } from "./chain-block.schema.js";
import type { TradeDraft } from "./match-trades.js";
import type { WalletTransfer } from "./wallet-transfers.js";

/** One trade of a tracked wallet, as the leader watcher read it (decision 0249). */
export interface WalletTrade {
  readonly account: AccountRef;
  readonly block: bigint;
  readonly blockHash: Hex;
  readonly txHash: TxHash;
  /** The first transfer log of `asset` in the transaction: with the hash, the trade's key. */
  readonly logIndex: number;
  /** The block's time. */
  readonly atMs: number;
  readonly side: "buy" | "sell";
  readonly asset: AssetRef;
  /** Base units of `asset`. */
  readonly amount: bigint;
  readonly counterAsset: AssetRef;
  /** Base units of `counterAsset`; 0 for a sale for the coin that could not be measured. */
  readonly counterAmount: bigint;
  /** The quote asset's side in USD at the block before, when its feed answered. */
  readonly valueUsdMicros?: bigint;
  /** For a sale: the share of the holding it took, when the holding before could be read. */
  readonly shareSoldBps?: Bps;
  /** The registry's venue whose contract the transaction called. */
  readonly venue?: string;
}

/** What the block before a trade held, read in one Multicall3 call. */
export interface PriorState {
  /** A wallet's holding of a token at the block before; `undefined` when it was not read. */
  readonly holding: (account: Address, token: Address) => bigint | undefined;
  /** The quote assets' USD prices, micro-dollars per base unit. */
  readonly prices: ReadonlyMap<AssetRef, Ratio>;
}

/** One block's trades to finish: its header and its tracked transfers. */
export interface BlockTrades {
  readonly header: BlockHeader;
  readonly transfers: readonly WalletTransfer[];
  readonly drafts: readonly TradeDraft[];
}

const wholeBps = BigInt(bpsPerWhole);
const bpsFromBase = z.bigint().pipe(z.coerce.number()).pipe(bpsSchema);

// The holding right before the sale: the block before's, plus the wallet's earlier transfers of
// the token in this block.
function holdingBefore(
  block: BlockTrades,
  draft: TradeDraft & { readonly soldToken: Address },
  prior: PriorState,
): bigint | undefined {
  const start = prior.holding(draft.account, draft.soldToken);
  if (start === undefined) {
    return undefined;
  }
  return block.transfers
    .filter(
      (transfer) =>
        transfer.account === draft.account &&
        transfer.token === draft.soldToken &&
        transfer.logIndex < draft.logIndex,
    )
    .reduce((holding, transfer) => holding + transfer.delta, start);
}

/** The share of a holding a sale took, rounded down, at most the whole. */
export function shareOf(sold: bigint, holding: bigint): Bps {
  const share = holding <= 0n || sold >= holding ? wholeBps : (sold * wholeBps) / holding;
  return bpsFromBase.parse(share);
}

function shareOfDraft(block: BlockTrades, draft: TradeDraft, prior: PriorState): Bps | undefined {
  const { soldToken } = draft;
  if (draft.side !== "sell" || soldToken === undefined) {
    return undefined;
  }
  const holding = holdingBefore(block, { ...draft, soldToken }, prior);
  return holding === undefined ? undefined : shareOf(draft.amount, holding);
}

function valueOf(draft: TradeDraft, prices: ReadonlyMap<AssetRef, Ratio>): bigint | undefined {
  const price = prices.get(draft.counterAsset);
  return price === undefined || draft.counterAmount === 0n
    ? undefined
    : (draft.counterAmount * price.numerator) / price.denominator;
}

/**
 * Finishes a block's trades: each with its block, its time, the share of the holding a sale took,
 * and the value of its quote side in USD, each left out when the state before was not read.
 */
export function finishTrades(
  chain: EvmChain,
  block: BlockTrades,
  prior: PriorState,
): readonly WalletTrade[] {
  const { header } = block;
  return block.drafts.map((draft) => {
    const { soldToken: _token, account, ...rest } = draft;
    const shareSoldBps = shareOfDraft(block, draft, prior);
    const valueUsdMicros = valueOf(draft, prior.prices);
    return {
      ...rest,
      account: evmAccountRef(chain, account),
      block: header.number,
      blockHash: header.hash,
      atMs: header.timestampMs,
      ...(shareSoldBps === undefined ? {} : { shareSoldBps }),
      ...(valueUsdMicros === undefined ? {} : { valueUsdMicros }),
    };
  });
}
