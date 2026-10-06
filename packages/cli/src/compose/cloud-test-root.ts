import type { AccountRef } from "@binference/chain";
import { createFakeSigner, type FakeSigner } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import {
  type CreditAccount,
  createCreditBilling,
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
}

/**
 * The test composition root of bInference Cloud: it wires the Cloud-shaped fakes where the
 * self-hosted root wires the owner's own adapters. A test that runs the engine on both shows that
 * nothing outside the composition roots notices the profile. Secrets come from one owner's share of
 * a hosted secret service.
 */
export function composeCloudTestRoot(options: CloudTestRootOptions = {}): CloudTestRoot {
  const market = createSharedMarketData();
  return {
    custody: createFakeSigner(options.wallets ?? new Map()),
    updates: createRelayUpdateSource(),
    billing: createCreditBilling(options.credits ?? []),
    secrets: createSecretVault().storeFor("owner"),
    stores: createMemoryEngineStores(),
    prices: market,
    market,
  };
}
