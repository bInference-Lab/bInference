import { type AccountRef, chainRefSchema } from "@binference/chain";
import {
  createFakeMarketSource,
  createFakeRiskSource,
  createFakeSigner,
  type FakeMarketSource,
  type FakeSigner,
} from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { createSourceMarketReads } from "@binference/engine/market";
import {
  type CreditAccount,
  createCreditBilling,
  createFakeCeilingEditor,
  createFakeWalletMaker,
  createMemoryEngineStores,
  createRelayUpdateSource,
  type MemoryEngineStores,
  type RelayUpdateSource,
  createSharedMarketData,
  type SharedMarketData,
} from "@binference/engine/testing";
import { createSecretVault } from "@binference/platform/testing";
import type { ProfileParts } from "./profile-parts.js";

/** What the Cloud test root starts with; a field left out starts empty. */
export interface CloudTestRootOptions {
  /** The agent wallets the signer service may sign for, each with its account. */
  readonly wallets?: ReadonlyMap<Id<"wal">, AccountRef>;
  /** The owners' bInference AI credit, each with the agents it pays for. */
  readonly credits?: readonly CreditAccount[];
}

/**
 * The profile-dependent parts as bInference Cloud fills them, each on a fake shaped like its Cloud
 * adapter, with the handles a test drives them by.
 */
export interface CloudTestRoot extends ProfileParts {
  /** A signer service whose wallets live in each owner's Privy account. */
  readonly custody: FakeSigner;
  /** The official bot's webhook relay: `deliver` is the bot's platform posting an update. */
  readonly updates: RelayUpdateSource;
  /** The store ports in memory, held to the contract suites every store adapter passes. */
  readonly stores: MemoryEngineStores;
  /** The shared market-data service: `publishPrice` and `publishBlock` feed every agent. */
  readonly prices: SharedMarketData;
  /** The same service, as the watchers' streams. */
  readonly market: SharedMarketData;
  /** The market data source the service reads once for every owner. */
  readonly marketSource: FakeMarketSource;
}

/**
 * The test composition root of bInference Cloud: it wires the Cloud-shaped fakes where the
 * self-hosted root wires the owner's own adapters. A test that runs the engine on both shows that
 * nothing outside the composition roots notices the profile. Secrets come from one owner's share of
 * a hosted secret service.
 */
export function composeCloudTestRoot(options: CloudTestRootOptions = {}): CloudTestRoot {
  const market = createSharedMarketData();
  const clock = createManualClock(0);
  const marketSource = createFakeMarketSource({
    id: "dexscreener",
    chains: [chainRefSchema.parse("fake:1")],
  });
  const wallets = new Map(options.wallets ?? []);
  const ceilings = createFakeCeilingEditor({ clock });
  return {
    custody: createFakeSigner(wallets),
    ceilings,
    // The signer service signs for each wallet made in the owner's Privy account at once.
    walletMaker: createFakeWalletMaker({
      clock,
      chain: chainRefSchema.parse("fake:1"),
      family: "fake",
      ceilings,
      onMade: (wallet, account) => wallets.set(wallet, account),
    }),
    updates: createRelayUpdateSource(),
    billing: createCreditBilling(options.credits ?? []),
    secrets: createSecretVault().storeFor("owner"),
    stores: createMemoryEngineStores(),
    prices: market,
    market,
    marketSource,
    marketReads: createSourceMarketReads({ sources: [marketSource], clock, timeoutMs: 5_000 }),
    // GoPlus alone: honeypot.is's terms forbid sharing its API, so Cloud never asks it.
    riskSources: [
      { source: createFakeRiskSource({ id: "goplus", reports: new Map() }), isRequired: true },
    ],
  };
}
