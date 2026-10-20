import {
  accountRefParts,
  type AssetRef,
  assetRefParts,
  type ChainRegistry,
  type TxHash,
} from "@binference/chain";
import type { TrackedWalletStore } from "../leaders/ports.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { CopyOrder } from "./copy-fills.js";
import { copiedHeldOf, type CopyState } from "./copy-state.js";

/**
 * How long behind the leader watcher's last block a trade's block must be before a copy order
 * copies it: 5 seconds of the chain's blocks, at least 2 (decision 0260). On BNB Smart Chain, 12
 * blocks, past its fast finality, so a reorganization that removes the trade is read again first.
 */
const confirmMs = 5_000;
const leastConfirmBlocks = 2n;

/**
 * The deepest block a copy order copies trades of now: the leader watcher's last block on the
 * leader's chain less the confirmation depth; none while the watcher has read no block.
 */
export async function confirmedBlockOf(
  parts: {
    readonly trackedWallets: Pick<TrackedWalletStore, "cursor">;
    readonly chains: ChainRegistry;
  },
  order: CopyOrder,
  signal: AbortSignal,
): Promise<bigint | undefined> {
  const chain = parts.chains.get(accountRefParts(order.request.trigger.leader).chain);
  if (!chain.ok) {
    return undefined;
  }
  const cursor = await parts.trackedWallets.cursor(chain.value.ref, { signal });
  const blocks = BigInt(Math.ceil(confirmMs / chain.value.definition.blockTimeMs));
  const depth = blocks > leastConfirmBlocks ? blocks : leastConfirmBlocks;
  return cursor === undefined ? undefined : cursor.block - depth;
}

/** A leader trade as a copy order judges it. */
export interface TradeSeen {
  readonly txHash: TxHash;
  readonly side: "buy" | "sell";
  readonly asset: AssetRef;
}

/** What a copy order judges a leader trade by: the chains, and the assets it never buys. */
export interface CopyFilterParts {
  readonly chains: ChainRegistry;
  /**
   * The assets a leader trade spends or gets: each chain's coin, the tokens that wrap it and the
   * stablecoins with a feed. The leader watcher counts a swap of one for another as a buy of the
   * one received, which no copy order follows, since its sale would never come (decision 0260).
   */
  readonly quotes: ReadonlySet<AssetRef>;
}

/**
 * Whether a copy order copies a leader trade (decision 0260): never one it took before by its
 * transaction, side and token, as a reorganization may store again; a buy of a token other than
 * the chain's coin, the quote assets and what the order spends; a sale of a token the order holds
 * from its own buys.
 */
export function isCopied(
  parts: CopyFilterParts,
  call: { readonly order: CopyOrder; readonly state: CopyState },
  trade: TradeSeen,
): boolean {
  const { order, state } = call;
  const { asset, side } = trade;
  const chain = parts.chains.get(accountRefParts(order.request.trigger.leader).chain);
  const wasTaken = state.recent.some(
    (seen) => seen.txHash === trade.txHash && seen.side === side && seen.asset === asset,
  );
  if (!chain.ok || assetRefParts(asset).chain !== chain.value.ref || wasTaken) {
    return false;
  }
  if (side === "sell") {
    return copiedHeldOf(state, asset) > 0n;
  }
  const isQuote = parts.quotes.has(asset) || asset === nativeAssetOf(chain.value);
  return !isQuote && asset !== order.request.spend;
}
