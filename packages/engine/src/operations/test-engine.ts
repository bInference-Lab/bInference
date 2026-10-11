import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type AssetRef,
  type ChainRegistry,
  chainRefSchema,
  createChainRegistry,
  type TxSimulator,
  type Venue,
  type UsdPrice,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigner,
  createFakeSigningScheme,
  createFakeTxSimulator,
  createFakeVenue,
  type FakeSigner,
} from "@binference/chain/testing";
import { createIdSource, type Id } from "@binference/core";
import { createManualClock, createSeededRandom, type ManualClock } from "@binference/core/testing";
import type { AgentDraft, AgentRecord } from "../agents/agent-record.js";
import { createFakeCeilingEditor, type FakeCeilingEditor } from "../fakes/fake-ceiling-editor.js";
import { createFakeExecutor, type FakeExecutor } from "../fakes/fake-executor.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createFakeRiskCheck } from "../fakes/fake-risk-check.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { createFakeWalletMaker, type FakeWalletMaker } from "../fakes/fake-wallet-maker.js";
import {
  createMemoryEngineStores,
  type MemoryEngineStores,
} from "../fakes/memory-engine-stores.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import { createQuoteSimulator } from "../fakes/quote-simulator.js";
import type { CeilingEditor, SignerRevoker, WalletExporter } from "../install/ports.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import {
  testAgent,
  testAgentDraft,
  testCoin,
  testNowMs,
  testWallet,
} from "../intents/test-intents.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import type {
  AgentStore,
  Executor,
  IntentStore,
  PositionStore,
  RiskCheck,
  Simulator,
} from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import type { EngineStores } from "../records/engine-stores.js";
import { createVenueHost } from "../venues/venue-host.js";
import { createEngine, type Engine, type EngineOptions } from "./create-engine.js";
import type { EngineCall, EngineCaller } from "./engine-call.js";

/**
 * The owner's CLI and an MCP client, as the server signs them in, and the agent runtime the engine
 * runs, proposing in a turn that read no outside content.
 */
export const testCallers: Readonly<Record<"cli" | "mcp" | "runtime", EngineCaller>> = {
  cli: {
    credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    client: { kind: "cli", version: "test" },
    scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
    transport: "ipc",
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
    turn: { hasOutsideContent: false },
  },
};

/** How a test engine differs from the default: a paper agent in manual mode on the fake venue. */
export interface TestEngineOptions {
  readonly agent?: Partial<AgentDraft>;
  readonly venues?: readonly Venue[];
  /** Why the simulator refuses every intent; it reports the quote's own amounts when absent. */
  readonly refusal?: SimulationFailure;
  /** Simulates instead of the quote simulator, such as one that measures a transfer tax. */
  readonly simulator?: Simulator;
  /** The chain registry; the fake chain with its one venue contract when absent. */
  readonly chains?: ChainRegistry;
  readonly facts?: Partial<WalletFacts>;
  /** The agent's wallets in the facts source; the test wallet alone when absent. */
  readonly wallets?: readonly Id<"wal">[];
  /** Wraps the intent store, so a test can make a write lose its race. */
  readonly intents?: (store: IntentStore) => IntentStore;
  /** Wraps the agent store the engine writes through, as `intents` does. */
  readonly agents?: (store: AgentStore) => AgentStore;
  /** What the paper portfolio opens with: 1 coin when absent, nothing when empty. */
  readonly paper?: readonly Amount[];
  /** Takes the confirmed live intents; a fake that keeps them when absent. */
  readonly executor?: Executor;
  /** The USD prices; the coin alone, at $600, when absent. */
  readonly prices?: ReadonlyMap<AssetRef, UsdPrice>;
  /** Whether the engine is locked; never when absent. */
  readonly isLocked?: () => boolean;
  /** The risk step; one that passes registry tokens and refuses others as `sources_down` when absent. */
  readonly risk?: RiskCheck;
  /** The ceilings the owner key changes; a fake holding none when absent. */
  readonly ceilings?: CeilingEditor;
  /** Custody's export of a wallet's key; none when absent. */
  readonly exporter?: WalletExporter;
  /** Custody's removal of a machine's agent key; none when absent. */
  readonly revoker?: SignerRevoker;
  /** Runs a rescue's sends; one under which every send reverts when absent. */
  readonly chainSimulator?: TxSimulator;
  /** What each account holds, as the wallet facts read it live; nothing when absent. */
  readonly held?: ReadonlyMap<AccountRef, readonly Amount[]>;
  /** Wallets custody holds besides the test wallet, each with its account. */
  readonly custodyWallets?: ReadonlyMap<Id<"wal">, AccountRef>;
}

/** An engine on memory stores and the fake chain, with what a test reads and drives. */
export interface TestEngine {
  readonly engine: Engine;
  readonly stores: MemoryEngineStores;
  readonly clock: ManualClock;
  readonly custody: FakeSigner;
  readonly positions: PositionStore;
  /** The executor the engine hands confirmed live intents to, when the test gave none. */
  readonly executor: FakeExecutor;
  /** Every push the engine sent, oldest first. */
  readonly pushes: readonly EnginePush[];
  /** The ceilings the engine changes, when the test gave none of its own. */
  readonly ceilings: FakeCeilingEditor;
  /** Makes the wallets `wallet/create` asks for, each signed for by the fake custody at once. */
  readonly walletMaker: FakeWalletMaker;
}

/** What the fake wallet facts say of the test wallet unless a test changes them. */
export const testFacts: WalletFacts = {
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 1_000_000_000n,
  networkFeeCapNativeBase: 1_000_000_000n,
  recentOutflows: [],
};

// The paper portfolio a test engine opens: one coin, $600 at the test price.
const testPaperBalances: readonly Amount[] = [{ asset: testCoin, base: 10n ** 18n }];

/** The test wallet's account on the fake chain. */
export const testAccount: AccountRef = accountRefSchema.parse("fake:1:0x0000000c");

/**
 * The chain registry of the fake chain, with its family and signing scheme, and a router at
 * `0x0000000d` for each venue of `otherVenues` beside the fake venue's.
 */
export function testChains(otherVenues: readonly string[] = []): ChainRegistry {
  const fake = createFakeChainDefinition();
  const routers = fake.contracts.flatMap((router) =>
    otherVenues.map((venue) => ({ ...router, venue, address: "0x0000000d" })),
  );
  return createChainRegistry({
    chains: [{ ...fake, contracts: [...fake.contracts, ...routers] }],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

// The stores the engine sees, with the intent and agent stores wrapped as the test asks.
function wrapped(stores: MemoryEngineStores, options: TestEngineOptions): EngineStores {
  return {
    ...stores,
    intents: options.intents?.(stores.intents) ?? stores.intents,
    agents: options.agents?.(stores.agents) ?? stores.agents,
  };
}

// Opens the agent's paper portfolio with the balances, or leaves it empty for none.
async function openPaper(engine: Engine, balances: readonly Amount[]): Promise<void> {
  if (balances.length > 0) {
    await engine.handlers["portfolio/resetPaper"](testCall({ agent: testAgent, balances }));
  }
}

// The steps a test may replace: the risk check and the simulators, fakes when it gives none.
function stepsOf(
  options: TestEngineOptions,
  fakes: { readonly chains: ChainRegistry; readonly clock: ManualClock },
): {
  readonly risk: RiskCheck;
  readonly simulator: Simulator;
  readonly chainSimulator: TxSimulator;
} {
  return {
    risk: options.risk ?? createFakeRiskCheck(fakes),
    simulator: options.simulator ?? createQuoteSimulator(() => options.refusal),
    chainSimulator: options.chainSimulator ?? createFakeTxSimulator(new Map()),
  };
}

// The wallet facts of the test agent's wallets, and what each account holds live.
function walletsOf(options: TestEngineOptions) {
  return createFakeWalletFacts(
    new Map([[testAgent, options.wallets ?? [testWallet]]]),
    { ...testFacts, ...options.facts },
    options.held,
  );
}

function custodyOf(options: TestEngineOptions): readonly (readonly [Id<"wal">, AccountRef])[] {
  return [...(options.custodyWallets ?? [])];
}

/** Starts an engine with its agent stored, on memory stores and the fake chain and venue. */
// Custody's export and its removal of a signer, each only when the test gives it.
function custodyParts(options: TestEngineOptions): Pick<EngineOptions, "exporter" | "revoker"> {
  const { exporter, revoker } = options;
  return {
    ...(exporter === undefined ? {} : { exporter }),
    ...(revoker === undefined ? {} : { revoker }),
  };
}

export async function startTestEngine(options: TestEngineOptions = {}): Promise<TestEngine> {
  const clock = createManualClock(testNowMs);
  const stores = createMemoryEngineStores();
  const held = new Map([[testWallet, testAccount], ...custodyOf(options)]);
  const custody = createFakeSigner(held);
  const chains = options.chains ?? testChains();
  const venues = options.venues ?? [createFakeVenue()];
  const pushes: EnginePush[] = [];
  const positions = createMemoryPositionStore();
  const executor = createFakeExecutor();
  const ceilings = createFakeCeilingEditor({ clock, chains });
  const walletMaker = createFakeWalletMaker({
    clock,
    chain: chainRefSchema.parse("fake:1"),
    family: "fake",
    ceilings,
    onMade: (wallet, account) => held.set(wallet, account),
  });
  const engine = createEngine({
    stores: wrapped(stores, options),
    positions,
    custody,
    ceilings: options.ceilings ?? ceilings,
    ...custodyParts(options),
    walletMaker,
    prices: createFakePriceSource(
      options.prices ?? new Map([[testCoin, { numerator: 600n, denominator: 10n ** 12n }]]),
    ),
    wallets: walletsOf(options),
    host: createVenueHost({ venues, chains, clock, callTimeoutMs: 5_000 }),
    ...stepsOf(options, { chains, clock }),
    executor: options.executor ?? executor,
    paperBalances: testPaperBalances,
    isLocked: options.isLocked ?? (() => false),
    chains,
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(3) }),
    random: createSeededRandom(4),
    publish: (push) => pushes.push(push),
  });
  await stores.agents.create(testAgentDraft(options.agent), { signal: AbortSignal.timeout(1_000) });
  await openPaper(engine, options.paper ?? testPaperBalances);
  return { engine, stores, clock, custody, positions, executor, pushes, ceilings, walletMaker };
}

/** One call with its args, from a caller, with a signal that never aborts. */
export function testCall<Args>(
  args: Args,
  caller: EngineCaller = testCallers.cli,
): Pick<EngineCall<never>, "caller" | "signal"> & { readonly args: Args } {
  return { args, caller, signal: new AbortController().signal };
}

function archived(agent: AgentRecord): AgentRecord {
  return { ...agent, archivedAtMs: 1 };
}

/** Wraps an agent store, as `TestEngineOptions.agents` takes one, to list every agent archived. */
export function listedArchived(store: AgentStore): AgentStore {
  return { ...store, list: async (call) => (await store.list(call)).map(archived) };
}
