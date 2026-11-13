import type { TxSimulator } from "@binference/chain";
import { createFakeTxSimulator } from "@binference/chain/testing";
import type { WalletFacts } from "@binference/engine";
import { createMemoryRiskCacheStore } from "@binference/engine/testing";
import type { ComposeEngineOptions } from "./compose-engine.js";

/**
 * The skeleton's token risk: no risk source answers, and no round trip step runs unless the test
 * gives a simulator, so a token the registry does not list fails closed.
 */
export function skeletonRiskOf(simulator?: TxSimulator): ComposeEngineOptions["risk"] {
  return {
    cache: createMemoryRiskCacheStore(["goplus", "honeypot"]),
    cacheTtlMs: () => 600_000,
    simulator: simulator ?? createFakeTxSimulator(new Map()),
  };
}

/** The skeleton wallet's facts: 1 coin, a ceiling of 1 coin a transaction, a 1 gwei fee. */
export const skeletonWalletFacts: WalletFacts = {
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 1_000_000_000n,
  networkFeeCapNativeBase: 1_000_000_000n,
  recentOutflows: [],
};
