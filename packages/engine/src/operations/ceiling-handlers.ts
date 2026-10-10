import type { ChainRegistry } from "@binference/chain";
import { type Clock, err, ok } from "@binference/core";
import type { CeilingRead } from "../install/ceiling-change.js";
import type { CeilingEditor } from "../install/ports.js";
import type { InstallStore } from "../ports.js";
import type { EngineHandler } from "./engine-call.js";

/** The handler that reads a wallet's ceiling (protocol spec, section 7.2). */
export interface CeilingHandlers {
  readonly "ceiling/get": EngineHandler<"ceiling/get">;
}

/** What reading a ceiling goes through: the install's wallets, custody and the registry. */
export interface CeilingHandlersOptions {
  readonly install: InstallStore;
  readonly ceilings: CeilingEditor;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

/** A registry contract of a venue, as an account in lower case. */
interface VenueContract {
  readonly venue: string;
  readonly account: string;
}

// The venues the ceiling lets a call reach every registry contract of, on the chains it enables.
function venuesIn(chains: ChainRegistry, read: CeilingRead): readonly string[] {
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

/**
 * Creates the `ceiling/get` handler: a wallet's ceiling as custody holds it now, read on each
 * call. Its venues are those whose every registry contract, on the chains the ceiling enables, a
 * call may reach. A wallet the install does not hold, or whose ceiling custody does not hold, is
 * `wallet.not_found`; while the engine is locked, custody answers `wallet.custody_down`.
 */
export function createCeilingHandlers(options: CeilingHandlersOptions): CeilingHandlers {
  return {
    async "ceiling/get"({ args, signal }) {
      const { wallets } = await options.install.read({ signal });
      const wallet = wallets.find((item) => item.id === args.wallet);
      const read =
        wallet === undefined ? undefined : await options.ceilings.read(wallet.policyId, { signal });
      if (wallet === undefined || read?.ok !== true) {
        return err("wallet.not_found");
      }
      const { chains, perTxNativeBase, recipients } = read.value;
      return ok({
        wallet: wallet.id,
        chains,
        venues: venuesIn(options.chains, read.value),
        perTxNative: perTxNativeBase,
        recipients,
        readAt: options.clock.now(),
      });
    },
  };
}
