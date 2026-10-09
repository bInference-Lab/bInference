import type { AccountRef, Amount, AssetRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { RescueMove } from "../intents/rescue-quote.js";

/** One wallet a rescue empties: its account on the rescue's chain and what it holds there now. */
export interface RescueWallet {
  readonly wallet: Id<"wal">;
  /** The agent the wallet belongs to. */
  readonly agentId: Id<"agt">;
  readonly account: AccountRef;
  /** The wallet's live balance of the native coin and of each token the rescue looks at. */
  readonly holdings: readonly Amount[];
  /** The native coin the wallet keeps for network fees: its agent's gas reserve on the chain. */
  readonly gasReserveBase: bigint;
}

function walletMoves(wallet: RescueWallet, nativeAsset: AssetRef): readonly RescueMove[] {
  const { account: from } = wallet;
  const signer = wallet.wallet;
  const tokens = wallet.holdings.filter(({ asset, base }) => asset !== nativeAsset && base > 0n);
  const nativeBase = wallet.holdings
    .filter(({ asset }) => asset === nativeAsset)
    .reduce((sum, { base }) => sum + base, 0n);
  const sentBase = nativeBase - wallet.gasReserveBase;
  return [
    ...tokens.map((amount) => ({ wallet: signer, from, amount })),
    ...(sentBase > 0n
      ? [{ wallet: signer, from, amount: { asset: nativeAsset, base: sentBase } }]
      : []),
  ];
}

/**
 * The moves of a rescue (decision 0044), wallet by wallet in the order given: every token the
 * wallet holds, whole and as it is, never sold; then its native coin above its gas reserve, which
 * stays to pay the rescue's own network fees and a stuck step's replacement. A wallet that holds
 * nothing above its reserve moves nothing.
 */
export function rescueMoves(
  wallets: readonly RescueWallet[],
  nativeAsset: AssetRef,
): readonly RescueMove[] {
  return wallets.flatMap((wallet) => walletMoves(wallet, nativeAsset));
}
