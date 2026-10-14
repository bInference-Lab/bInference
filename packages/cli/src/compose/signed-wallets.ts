import type { ChainRef, ChainRegistry } from "@binference/chain";
import type { Id } from "@binference/core";
import { isPrivyId, type PrivyWallet } from "@binference/custody-privy";
import type { WalletRecord } from "@binference/engine/install";
import type { BinferenceConfig } from "../config/schema/config.schema.js";

/** What the wallets custody signs for are read with: the registry and the enabled chains. */
export interface SignedWalletsOptions {
  readonly chains: ChainRegistry;
  readonly config: Pick<BinferenceConfig, "chains">;
}

// The chains a wallet signs on: those config enables of its family.
function chainsOf(record: WalletRecord, options: SignedWalletsOptions): readonly ChainRef[] {
  return options.chains
    .list()
    .filter((chain) => chain.definition.family === record.family)
    .map((chain) => chain.ref)
    .filter((chain) => options.config.chains.enabled.includes(chain));
}

/**
 * The live wallets the `privy-owner` adapter signs for, by the engine's id: each with its Privy id,
 * its address, the chains config enables of its family, and its role when it is a launch wallet
 * (decision 0217). A wallet whose id is none of Privy's is left out.
 */
export function signedWalletsOf(
  records: readonly WalletRecord[],
  options: SignedWalletsOptions,
): Map<Id<"wal">, PrivyWallet> {
  return new Map(
    records
      .filter((record) => record.archivedAtMs === undefined)
      .flatMap((record): readonly (readonly [Id<"wal">, PrivyWallet])[] => {
        const { custodyWalletId: id, address, role } = record;
        if (!isPrivyId(id)) {
          return [];
        }
        const chains = chainsOf(record, options);
        return [
          [record.id, role === undefined ? { id, address, chains } : { id, address, chains, role }],
        ];
      }),
  );
}
