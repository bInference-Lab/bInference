import {
  type AccountRef,
  type AssetRef,
  type AssetTransfer,
  type ChainFamily,
  isSameAccount,
} from "@binference/chain";

/** The wallet whose balance transfers change, and the family that compares its accounts. */
export interface WalletHolder {
  readonly wallet: AccountRef;
  readonly family: ChainFamily;
}

/**
 * A transfer's change to the wallet's balance: what leaves it counts against it, what arrives
 * for it, and a transfer the wallet makes to itself, or one between others, not at all.
 */
export function transferChange(transfer: AssetTransfer, holder: WalletHolder): bigint {
  const leaves = isSameAccount(transfer.from, holder.wallet, holder.family);
  const arrives = isSameAccount(transfer.to, holder.wallet, holder.family);
  if (leaves === arrives) {
    return 0n;
  }
  return leaves ? -transfer.amount.base : transfer.amount.base;
}

/**
 * Each asset's net change to the wallet's balance over the transfers, by asset: below zero for
 * what the wallet spent, above for what it received. The simulation check and reconciliation
 * both count a wallet's balance this way.
 */
export function walletChanges(
  transfers: readonly AssetTransfer[],
  holder: WalletHolder,
): ReadonlyMap<AssetRef, bigint> {
  const changes = new Map<AssetRef, bigint>();
  for (const transfer of transfers) {
    const { asset } = transfer.amount;
    changes.set(asset, (changes.get(asset) ?? 0n) + transferChange(transfer, holder));
  }
  return changes;
}
