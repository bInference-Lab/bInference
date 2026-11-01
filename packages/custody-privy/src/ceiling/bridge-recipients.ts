import { addressesOn } from "./address-list.js";
import type { BridgeDeposit, BridgeTarget, ChainAddresses } from "./ceiling.js";

/** What a ceiling pays, from which a bridge deposit's recipients are derived on every write. */
export interface CeilingAddresses {
  /**
   * Per chain, every address the owner key lets the wallet pay there: on an enabled chain the
   * rescue address and the addresses saved for it, on a destination those saved for it.
   */
  readonly recipients: readonly ChainAddresses[];
  /** Per destination chain, the addresses a bridge may pay there. */
  readonly bridged: readonly ChainAddresses[];
}

const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/**
 * The bridge targets of a chain's deposits (decisions 0302 and 0313): each deposit with the
 * addresses `bridged` names for its destination that `recipients` still lists for that chain, so
 * removing a saved address, or replacing the rescue address, takes it out of every destination in
 * the same change. A deposit with no such address gives no target, so no rule pays anyone there.
 */
export function bridgeTargetsOf(
  deposits: readonly BridgeDeposit[],
  addresses: CeilingAddresses,
): readonly BridgeTarget[] {
  return deposits.flatMap((deposit): readonly BridgeTarget[] => {
    const chainId = deposit.destinationChainId;
    const payable = addressesOn(addresses.recipients, chainId);
    const recipients = addressesOn(addresses.bridged, chainId).filter((address) =>
      payable.some((recipient) => same(recipient, address)),
    );
    return recipients.length === 0 ? [] : [{ ...deposit, recipients }];
  });
}

/** The addresses each destination's bridge rules list, as the targets a ceiling holds name them. */
export function bridgedOf(
  targets: readonly Pick<BridgeTarget, "destinationChainId" | "recipients">[],
): readonly ChainAddresses[] {
  const chainIds = [...new Set(targets.map((target) => target.destinationChainId))];
  return chainIds.map((chainId) => ({
    chainId,
    addresses: [
      ...new Set(
        targets
          .filter((target) => target.destinationChainId === chainId)
          .flatMap((target) => target.recipients),
      ),
    ],
  }));
}
