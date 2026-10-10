import type { ChainRegistry } from "@binference/chain";
import type { Id } from "@binference/core";
import type { CeilingView } from "@binference/protocol";
import type { CeilingRead } from "../install/ceiling-change.js";

/** A registry contract of a venue, as an account in lower case. */
interface VenueContract {
  readonly venue: string;
  readonly account: string;
}

/**
 * The venues a ceiling lets a call reach every registry contract of, on the chains it enables.
 * A venue with no contract on those chains is not one of them.
 */
export function venuesIn(chains: ChainRegistry, read: CeilingRead): readonly string[] {
  const reached = new Set(read.contracts.map((account) => account.toLowerCase()));
  const contracts = chains
    .list()
    .filter((chain) => read.chains.includes(chain.ref))
    .flatMap((chain) =>
      chain.definition.contracts.map((contract): VenueContract => ({
        venue: contract.venue,
        account: `${chain.ref}:${contract.address}`.toLowerCase(),
      })),
    );
  const venues = [...new Set(contracts.map((contract) => contract.venue))];
  return venues.filter((venue) =>
    contracts
      .filter((contract) => contract.venue === venue)
      .every((contract) => reached.has(contract.account)),
  );
}

/** A wallet's ceiling as `ceiling/get` and `ceiling/set` answer it, read at `readAt`. */
export function ceilingViewOf(
  chains: ChainRegistry,
  held: { readonly wallet: Id<"wal">; readonly read: CeilingRead; readonly readAt: number },
): CeilingView {
  const { wallet, read, readAt } = held;
  return {
    wallet,
    chains: read.chains,
    venues: venuesIn(chains, read),
    perTxNative: read.perTxNativeBase,
    recipients: read.recipients,
    readAt,
  };
}
