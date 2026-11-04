import type { Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { testAgent, testWallet } from "../intents/test-intents.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import { testChains } from "../operations/test-engine.js";
import type { VenueHost } from "../venues/venue-host.js";
import type { ExecutorOptions } from "./executor-options.js";

/** The parts of a bench whose executor signs a launch wallet's curve trades. */
export interface BenchLaunch {
  readonly venues: readonly Venue[];
  readonly curves: Pick<VenueHost, "curves">;
  readonly chains: ReturnType<typeof testChains>;
  readonly wallets: readonly Id<"wal">[];
}

const facts: Omit<WalletFacts, "recentOutflows"> = {
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 50_000_000n,
  networkFeeCapNativeBase: 1_000_000_000n,
};

/**
 * The agent's wallets, the registry and the venues a bench's executor reads, and the launchpads'
 * curve reads when the bench trades on a launch's own curve.
 */
export function launchPartsOf(options: {
  readonly launch?: BenchLaunch;
  readonly recentOutflows?: WalletFacts["recentOutflows"];
  readonly facts?: Partial<Omit<WalletFacts, "recentOutflows">>;
}): Pick<ExecutorOptions, "wallets" | "chains" | "venues" | "curves"> {
  const { launch, recentOutflows = [] } = options;
  const held = new Map([[testAgent, launch?.wallets ?? [testWallet]]]);
  const wallets = createFakeWalletFacts(held, { ...facts, ...options.facts, recentOutflows });
  return launch === undefined
    ? { wallets, chains: testChains(), venues: [createFakeVenue()] }
    : { wallets, chains: launch.chains, venues: launch.venues, curves: launch.curves };
}
