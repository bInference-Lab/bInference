import type { BridgeDeposit, BridgedAddresses, BridgeTarget } from "./ceiling.js";

/** What a ceiling pays, from which a bridge deposit's recipients are derived on every write. */
export interface CeilingAddresses {
  /** The rescue address and the saved addresses: every address a send may pay. */
  readonly recipients: readonly string[];
  /** Per destination chain, the addresses a bridge may pay there. */
  readonly bridged: readonly BridgedAddresses[];
}

const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/**
 * The bridge targets of a chain's deposits (decision 0302): each deposit with the addresses
 * `bridged` names for its destination that are still among `recipients`, so removing a saved
 * address, or replacing the rescue address, takes it out of every destination in the same change.
 * A deposit with no such address gives no target, so no rule pays anyone there.
 */
export function bridgeTargetsOf(
  deposits: readonly BridgeDeposit[],
  addresses: CeilingAddresses,
): readonly BridgeTarget[] {
  return deposits.flatMap((deposit): readonly BridgeTarget[] => {
    const named = addresses.bridged
      .filter((item) => item.chainId === deposit.destinationChainId)
      .flatMap((item) => item.addresses);
    const recipients = named.filter((address) =>
      addresses.recipients.some((recipient) => same(recipient, address)),
    );
    return recipients.length === 0 ? [] : [{ ...deposit, recipients }];
  });
}

/** The addresses each destination's bridge rules list, as the targets a ceiling holds name them. */
export function bridgedOf(
  targets: readonly Pick<BridgeTarget, "destinationChainId" | "recipients">[],
): readonly BridgedAddresses[] {
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
