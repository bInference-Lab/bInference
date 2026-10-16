import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type AssetRef,
  type ChainRegistry,
  chainRefSchema,
  createChainRegistry,
  type PriceSource,
  type TxSimulator,
  type Venue,
  type UsdPrice,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigner,
  createFakeSigningScheme,
  createFakeVenue,
  type FakeSigner,
} from "@binference/chain/testing";
import { createIdSource, type Id, idSchema } from "@binference/core";
import {
  createManualClock,
  createMemoryWorkspaceFiles,
  createSeededRandom,
  type ManualClock,
} from "@binference/core/testing";
import type { AgentDraft, AgentRecord } from "../agents/agent-record.js";
import { createRunningTurns, type RunningTurns } from "../chat/running-turns.js";
import { createFakeCeilingEditor, type FakeCeilingEditor } from "../fakes/fake-ceiling-editor.js";
import { createFakeExecutor, type FakeExecutor } from "../fakes/fake-executor.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { createFakeWalletMaker, type FakeWalletMaker } from "../fakes/fake-wallet-maker.js";
import {
  createMemoryEngineStores,
  type MemoryEngineStores,
} from "../fakes/memory-engine-stores.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import type { CeilingEditor, SignerRevoker, WalletExporter } from "../install/ports.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import {
  testAgent,
  testAgentDraft,
  testCoin,
  testNowMs,
  testWallet,
} from "../intents/test-intents.js";
import type { MarketReads } from "../market/ports.js";
import type { ReadTokenFacts } from "../money-path/token-facts.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import type { OrderFills } from "../orders/fill-orders.js";
import type { OrderStore } from "../orders/ports.js";
import type {
  AgentStore,
  Executor,
  IntentStore,
  PositionStore,
  RiskCheck,
  Simulator,
  WalletFactsSource,
} from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import type { EngineStores } from "../records/engine-stores.js";
import type { UploadShelf } from "../uploads/upload-shelf.js";
import { createEngineWithFills, type Engine, type EngineOptions } from "./create-engine.js";
import type { EngineCall, EngineCaller } from "./engine-call.js";
import { hostsOf, readsOf, stepsOf } from "./test-engine-parts.js";

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
  /** The owner's timezone, whose days the model budget runs over; UTC when absent. */
  readonly timeZone?: string;
  /** The tokens the price watcher cannot price; it prices every other. */
  readonly unpriceable?: readonly AssetRef[];
  /** What tokens the registry does not list answer on chain; `UNL` with 18 decimals when absent. */
  readonly tokenFacts?: ReadTokenFacts;
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
  /** Wraps the order store the engine reads and writes through, as `intents` does. */
  readonly orders?: (store: OrderStore) => OrderStore;
  /** What the paper portfolio opens with: 1 coin when absent, nothing when empty. */
  readonly paper?: readonly Amount[];
  /** Takes the confirmed live intents; a fake that keeps them when absent. */
  readonly executor?: Executor;
  /** The USD prices; the coin alone, at $600, when absent. */
  readonly prices?: ReadonlyMap<AssetRef, UsdPrice>;
  /** Wraps the wallet facts source, so a test can make a balance read answer partly. */
  readonly walletFacts?: (source: WalletFactsSource) => WalletFactsSource;
  /** Wraps the price source, so a test can make a read hang. */
  readonly priceSource?: (source: PriceSource) => PriceSource;
  /** Whether the engine is locked; never when absent. */
  readonly isLocked?: () => boolean;
  /** Whether a live order may fill and so be made; off when absent, as in the product now. */
  readonly liveOrderFills?: boolean;
  /** The risk step; one that passes registry tokens and refuses others as `sources_down` when absent. */
  readonly risk?: RiskCheck;
  /** The ceilings the owner key changes; a fake holding none when absent. */
  readonly ceilings?: CeilingEditor;
  /** Custody's export of a wallet's key; none when absent. */
  readonly exporter?: WalletExporter;
  /** The market reads; reads over no data source, which know nothing, when absent. */
  readonly marketReads?: MarketReads;
  /** Custody's removal of a machine's agent key; none when absent. */
  readonly revoker?: SignerRevoker;
  /** Runs a rescue's sends; one under which every send reverts when absent. */
  readonly chainSimulator?: TxSimulator;
  /** What each account holds, as the wallet facts read it live; nothing when absent. */
  readonly held?: ReadonlyMap<AccountRef, readonly Amount[]>;
  /** Wallets custody holds besides the test wallet, each with its account. */
  readonly custodyWallets?: ReadonlyMap<Id<"wal">, AccountRef>;
  /** The owner's uploads, shared with the test that fills them. */
  readonly uploads?: UploadShelf;
}

/** An engine on memory stores and the fake chain, with what a test reads and drives. */
/** The engine a test runs, with its order fills, which a test may run at any price. */
type TestRunningEngine = Engine & { readonly fillOrder: OrderFills["run"] };

export interface TestEngine {
  readonly engine: TestRunningEngine;
  /** The options the engine was made with, as a restart makes it again. */
  readonly engineOptions: EngineOptions;
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
  /** The runtime's running turns, started with the test runtime's token. */
  readonly turns: RunningTurns;
  /**
   * Starts a new engine on the same stores and fakes, as a restart does: nothing it kept in
   * memory survives, and it opens no paper portfolio again; with live fills turned as told.
   */
  readonly restart: (changed?: Pick<EngineOptions, "liveOrderFills">) => TestRunningEngine;
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
    orders: options.orders?.(stores.orders) ?? stores.orders,
  };
}

// Opens the agent's paper portfolio with the balances, or leaves it empty for none.
async function openPaper(engine: Engine, balances: readonly Amount[]): Promise<void> {
  if (balances.length > 0) {
    await engine.handlers["portfolio/resetPaper"](testCall({ agent: testAgent, balances }));
  }
}

// The wallet facts of the test agent's wallets, and what each account holds live.
function walletsOf(options: TestEngineOptions) {
  const source = createFakeWalletFacts(
    new Map([[testAgent, options.wallets ?? [testWallet]]]),
    { ...testFacts, ...options.facts },
    options.held,
  );
  return options.walletFacts?.(source) ?? source;
}

function custodyOf(options: TestEngineOptions): readonly (readonly [Id<"wal">, AccountRef])[] {
  return [...(options.custodyWallets ?? [])];
}

// Custody's export and its removal of a signer, each only when the test gives it.
function custodyParts(options: TestEngineOptions): Pick<EngineOptions, "exporter" | "revoker"> {
  const { exporter, revoker } = options;
  return {
    ...(exporter === undefined ? {} : { exporter }),
    ...(revoker === undefined ? {} : { revoker }),
  };
}

// The runtime's running turns, started with the test runtime's token.
function testTurns(): RunningTurns {
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(testCallers.runtime.credential));
  return turns;
}

// A new engine on the same stores, with ids of its own, as a restart starts one.
function restartOf(
  options: EngineOptions,
): (changed?: Pick<EngineOptions, "liveOrderFills">) => TestRunningEngine {
  const ids = createIdSource({ clock: options.clock, random: createSeededRandom(5) });
  return (changed = {}) => runningEngineOf({ ...options, ...changed, ids });
}

// The engine with its order fills beside it, as a test runs it.
function runningEngineOf(options: EngineOptions): TestRunningEngine {
  const { engine, fillOrder } = createEngineWithFills(options);
  return { ...engine, fillOrder };
}

/** Starts an engine with its agent stored, on memory stores and the fake chain and venue. */
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
  const turns = testTurns();
  const engineOptions: EngineOptions = {
    turns,
    ownerTimeZone: () => options.timeZone ?? "UTC",
    stores: wrapped(stores, options),
    positions,
    custody,
    ceilings: options.ceilings ?? ceilings,
    ...custodyParts(options),
    walletMaker,
    ...readsOf(options, clock),
    wallets: walletsOf(options),
    ...hostsOf({ venues, chains, clock }),
    ...stepsOf(options, { chains, clock }),
    executor: options.executor ?? executor,
    paperBalances: testPaperBalances,
    workspace: createMemoryWorkspaceFiles(clock),
    isLocked: options.isLocked ?? (() => false),
    liveOrderFills: options.liveOrderFills === true,
    ...(options.uploads === undefined ? {} : { uploads: options.uploads }),
    chains,
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(3) }),
    random: createSeededRandom(4),
    publish: (push) => pushes.push(push),
  };
  const engine = runningEngineOf(engineOptions);
  await stores.agents.create(testAgentDraft(options.agent), { signal: AbortSignal.timeout(1_000) });
  await openPaper(engine, options.paper ?? testPaperBalances);
  const fakes = { custody, positions, executor, pushes, ceilings, walletMaker, turns };
  return { engine, engineOptions, stores, clock, ...fakes, restart: restartOf(engineOptions) };
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

/**
 * A `TestEngineOptions.agents` wrapper that lists every agent archived while `get` still finds it
 * live, to stage an agent archived during a call. It breaks the store's contract on purpose, so it
 * is a wrapper for one option and not a store of its own.
 */
export const listedArchived: NonNullable<TestEngineOptions["agents"]> = (store) => ({
  ...store,
  list: async (call) => (await store.list(call)).map(archived),
});
