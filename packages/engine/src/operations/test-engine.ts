import {
  type AccountRef,
  accountRefSchema,
  type ChainRegistry,
  createChainRegistry,
  type Venue,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigner,
  createFakeSigningScheme,
  createFakeVenue,
  type FakeSigner,
} from "@binference/chain/testing";
import { createIdSource, type Id } from "@binference/core";
import { createManualClock, createSeededRandom, type ManualClock } from "@binference/core/testing";
import type { AgentDraft } from "../agents/agent-record.js";
import { createFakeExecutor, type FakeExecutor } from "../fakes/fake-executor.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import {
  createMemoryEngineStores,
  type MemoryEngineStores,
} from "../fakes/memory-engine-stores.js";
import { createQuoteSimulator } from "../fakes/quote-simulator.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import {
  testAgent,
  testAgentDraft,
  testCoin,
  testNowMs,
  testWallet,
} from "../intents/test-intents.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import type { Executor, IntentStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createVenueHost } from "../venues/venue-host.js";
import { createEngine, type Engine } from "./create-engine.js";
import type { EngineCall, EngineCaller } from "./engine-call.js";

/** The owner's CLI, an MCP client and the agent runtime, as the server signs them in. */
export const testCallers: Readonly<Record<"cli" | "mcp" | "runtime", EngineCaller>> = {
  cli: {
    credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    client: { kind: "cli", version: "test" },
    scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  },
  mcp: {
    credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000002",
    client: { kind: "mcp", version: "test" },
    scopes: ["read", "propose"],
  },
  runtime: {
    credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000003",
    client: { kind: "runtime", version: "test" },
    scopes: ["read", "propose", "agent"],
  },
};

/** How a test engine differs from the default: a paper agent in manual mode on the fake venue. */
export interface TestEngineOptions {
  readonly agent?: Partial<AgentDraft>;
  readonly venues?: readonly Venue[];
  /** Why the simulator refuses every intent; it reports the quote's own amounts when absent. */
  readonly refusal?: SimulationFailure;
  readonly facts?: Partial<WalletFacts>;
  /** The agent's wallets in the facts source; the test wallet alone when absent. */
  readonly wallets?: readonly Id<"wal">[];
  /** Wraps the intent store, so a test can make a write lose its race. */
  readonly intents?: (store: IntentStore) => IntentStore;
  /** Takes the confirmed live intents; a fake that keeps them when absent. */
  readonly executor?: Executor;
}

/** An engine on memory stores and the fake chain, with what a test reads and drives. */
export interface TestEngine {
  readonly engine: Engine;
  readonly stores: MemoryEngineStores;
  readonly clock: ManualClock;
  readonly custody: FakeSigner;
  /** The executor the engine hands confirmed live intents to, when the test gave none. */
  readonly executor: FakeExecutor;
  /** Every push the engine sent, oldest first. */
  readonly pushes: readonly EnginePush[];
}

const defaultFacts: WalletFacts = {
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 1_000_000_000n,
  networkFeeCapNativeBase: 1_000_000_000n,
  recentOutflows: [],
};

/** The test wallet's account on the fake chain. */
export const testAccount: AccountRef = accountRefSchema.parse("fake:1:0x0000000c");

/** The chain registry of the fake chain, with its family and signing scheme. */
export function testChains(): ChainRegistry {
  return createChainRegistry({
    chains: [createFakeChainDefinition()],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

/** Starts an engine with its agent stored, on memory stores and the fake chain and venue. */
export async function startTestEngine(options: TestEngineOptions = {}): Promise<TestEngine> {
  const clock = createManualClock(testNowMs);
  const stores = createMemoryEngineStores();
  const custody = createFakeSigner(new Map([[testWallet, testAccount]]));
  const chains = testChains();
  const venues = options.venues ?? [createFakeVenue()];
  const pushes: EnginePush[] = [];
  const intents = options.intents?.(stores.intents) ?? stores.intents;
  const executor = createFakeExecutor();
  const engine = createEngine({
    stores: { ...stores, intents },
    custody,
    prices: createFakePriceSource(
      new Map([[testCoin, { numerator: 600n, denominator: 10n ** 12n }]]),
    ),
    wallets: createFakeWalletFacts(new Map([[testAgent, options.wallets ?? [testWallet]]]), {
      ...defaultFacts,
      ...options.facts,
    }),
    host: createVenueHost({ venues, chains, clock, callTimeoutMs: 5_000 }),
    simulator: createQuoteSimulator(() => options.refusal),
    executor: options.executor ?? executor,
    chains,
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(3) }),
    publish: (push) => pushes.push(push),
  });
  await stores.agents.create(testAgentDraft(options.agent), { signal: AbortSignal.timeout(1_000) });
  return { engine, stores, clock, custody, executor, pushes };
}

/** One call with its args, from a caller, with a signal that never aborts. */
export function testCall<Args>(
  args: Args,
  caller: EngineCaller = testCallers.cli,
): Pick<EngineCall<never>, "caller" | "signal"> & { readonly args: Args } {
  return { args, caller, signal: new AbortController().signal };
}
