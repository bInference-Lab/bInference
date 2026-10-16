import {
  type ChainDefinition,
  type ChainRegistry,
  type AccountRef,
  accountRefSchema,
  type Amount,
  chainRefSchema,
  createChainRegistry,
  type TxSimulator,
  type Venue,
} from "@binference/chain";
import { createEvmFamily, createEvmSigningScheme } from "@binference/chain-evm";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigner,
  createFakeSigningScheme,
  createFakeTxSimulator,
  createFakeVenue,
} from "@binference/chain/testing";
import { bsc } from "@binference/chains";
import { BinferenceError, idSchema, ok } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createMemoryWorkspaceFiles,
  createScriptedHttp,
  createSeededRandom,
  type ManualClock,
  type MemoryLogger,
} from "@binference/core/testing";
import { type PositionStore, sha256Hex } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import {
  createFakeExecutor,
  createFakePriceSource,
  createFakeTokenFacts,
  createFakeWalletFacts,
  createFakeCeilingEditor,
  createFakeWalletExporter,
  createFakeWalletMaker,
  createMemoryEngineStores,
  createMemoryPositionStore,
  createMemoryRiskCacheStore,
  type MemoryEngineStores,
  createQuoteSimulator,
  type FakeExecutor,
  testAgent,
  testAgentDraft,
  testCoin,
  testNowMs,
  testWallet,
  testWalletRecord,
} from "@binference/engine/testing";
import type { OwnerInfo } from "@binference/protocol";
import { sealTo } from "../export/key-recipient.js";
import { composeCloudTestRoot } from "./cloud-test-root.js";
import {
  type ComposedEngine,
  composeEngine,
  type ComposeEngineOptions,
  type EngineParts,
} from "./compose-engine.js";
import type { TelegramParts } from "./compose-telegram.js";
import { createEngineOperations } from "./engine-operations.js";
import { type LoopbackServing, serveOnLoopback } from "./loopback-serving.js";
import { selfHostedMarketReads, selfHostedSources } from "./market-reads.js";
import { selfHostedRiskSources } from "./risk-sources.js";

/** The secrets of the CLI token, with every scope, and of the MCP token, with read and propose. */
export const skeletonSecrets: Readonly<Record<"cli" | "mcp", string>> = {
  cli: `bnt_${"1".repeat(43)}`,
  mcp: `bnt_${"2".repeat(43)}`,
};

const account: AccountRef = accountRefSchema.parse("fake:1:0x0000000c");
// $600 a coin: 600 dollars in micro-dollars for 10^18 base units.
const coinPrice = { numerator: 600_000_000n, denominator: 10n ** 18n };
const wallets = new Map([[testWallet, account]]);
// The test agent's one wallet, as setting up an install stores it.
const walletRecord = testWalletRecord({
  id: testWallet,
  agentId: testAgent,
  label: "Main",
  createdAtMs: testNowMs - 1_000,
});

/** The test wallet's private key, which the self-hosted skeleton's custody exports, sealed. */
export const skeletonWalletKey: string = `0x${"5e".repeat(32)}`;

function withTestWallet<Stores extends MemoryEngineStores>(stores: Stores): Stores {
  stores.install.addWallet(walletRecord);
  return stores;
}
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });

/** A composition the skeleton runs on: its name and how its profile parts are made. */
export interface SkeletonComposition {
  readonly name: string;
  readonly parts: () => EngineParts;
}

/**
 * The skeleton's chains: the fake chain and BNB Smart Chain, whose registries give each venue's
 * contracts a ceiling lists.
 */
export function skeletonChains(): ChainRegistry {
  return createChainRegistry({
    chains: [createFakeChainDefinition(), bsc],
    families: [createFakeFamily(), createEvmFamily()],
    signingSchemes: [createFakeSigningScheme(), createEvmSigningScheme()],
  });
}

/** The two compositions: the self-hosted one and the Cloud-shaped test root. */
export const skeletonCompositions: readonly SkeletonComposition[] = [
  {
    // The self-hosted root's custody and Chainlink price adapters stand in as fakes here.
    name: "self-hosted",
    parts: () => {
      const held = new Map(wallets);
      const clock = createManualClock(testNowMs);
      const ceilings = createFakeCeilingEditor({ clock, chains: skeletonChains() });
      const keys = new Map([[walletRecord.custodyWalletId, skeletonWalletKey]]);
      return {
        exporter: createFakeWalletExporter({ keys, seal: sealTo }),
        custody: createFakeSigner(held),
        ceilings,
        walletMaker: createFakeWalletMaker({
          clock,
          chain: chainRefSchema.parse("fake:1"),
          family: "fake",
          ceilings,
          onMade: (wallet, made) => held.set(wallet, made),
        }),
        stores: withTestWallet(createMemoryEngineStores()),
        prices: createFakePriceSource(new Map([[testCoin, coinPrice]])),
        // The self-hosted sources, over outbound HTTP that reaches no host.
        riskSources: selfHostedRiskSources(createScriptedHttp([])),
        marketReads: selfHostedMarketReads(
          selfHostedSources({ http: createScriptedHttp([]), clock }),
          clock,
        ),
      };
    },
  },
  {
    name: "Cloud-shaped",
    parts: () => {
      const root = composeCloudTestRoot({ wallets });
      withTestWallet(root.stores);
      root.prices.publishPrice({ asset: testCoin, price: coinPrice, atMs: testNowMs });
      return root;
    },
  },
];

async function addToken(
  parts: Pick<EngineParts, "stores">,
  kind: "cli" | "mcp",
  n: number,
): Promise<void> {
  const scopes =
    kind === "cli"
      ? (["read", "propose", "chat", "confirm", "loosen", "admin"] as const)
      : (["read", "propose"] as const);
  const id = idSchema("tok").parse(`tok_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`);
  const secretHash = sha256Hex(skeletonSecrets[kind]);
  await parts.stores.access.addToken(
    { id, label: kind, kind, scopes, secretHash, createdAtMs: 0 },
    live(),
  );
}

/** Stores the CLI token, with every scope, and the MCP token, whose secrets the skeleton knows. */
export async function addSkeletonTokens(parts: Pick<EngineParts, "stores">): Promise<void> {
  await addToken(parts, "cli", 1);
  await addToken(parts, "mcp", 2);
}

// The engine's test agent, on paper in manual mode, the CLI token and the MCP token.
async function seed(parts: EngineParts): Promise<void> {
  const created = await parts.stores.agents.create(testAgentDraft(), live());
  if (!created.ok) {
    throw new BinferenceError({ code: "test.seed_failed", message: "The agent is stored." });
  }
  await addSkeletonTokens(parts);
}

/** The engine and its server on the profile parts, with what a test reads and drives. */
export interface ComposedSkeleton {
  readonly parts: EngineParts;
  readonly composed: ComposedEngine;
  readonly clock: ManualClock;
  readonly positions: PositionStore;
  /** Stands in for the wallet queue: what reached it. */
  readonly executor: FakeExecutor;
  /** What the engine, its server and the bot logged. */
  readonly logger: MemoryLogger;
}

/** The engine, its server, an IPC stand-in and a CLI client, in one process. */
export interface Skeleton extends ComposedSkeleton, LoopbackServing {}

// No risk source answers and no round trip step runs, so a token the registry does not list fails
// closed.
const skeletonRisk: ComposeEngineOptions["risk"] = {
  cache: createMemoryRiskCacheStore(["goplus", "honeypot"]),
  cacheTtlMs: () => 600_000,
  simulator: createFakeTxSimulator(new Map()),
};

/** What a skeleton adds to its profile parts. */
export interface SkeletonOptions {
  /** The owner's bot; without it the skeleton serves no Telegram. */
  readonly telegram?: TelegramParts;
  /** The venues the engine trades on; the fake venue alone when left out. */
  readonly venues?: readonly Venue[];
  /** Chains the engine knows besides the fake chain, such as BNB Smart Chain. */
  readonly chains?: readonly ChainDefinition[];
  /** The fake chain under other names and tokens; `createFakeChainDefinition` when left out. */
  readonly fakeChain?: ChainDefinition;
  /** What a reset paper portfolio starts with; one coin when left out. */
  readonly paperBalances?: readonly Amount[];
  /** What each account holds; nothing when left out. */
  readonly held?: ReadonlyMap<AccountRef, readonly Amount[]>;
  /** Runs a rescue's sends and the token round trips; nothing runs when left out. */
  readonly chainSimulator?: TxSimulator;
  /** The owner's language and timezone now; English in UTC when left out. */
  readonly owner?: () => OwnerInfo;
  /** The handlers only the owner's bot runs, such as the owner's language change. */
  readonly ownerChat?: ComposeEngineOptions["ownerChat"];
  /** The HTTP listener with the console's files; the server serves IPC only when left out. */
  readonly browser?: Pick<ComposeEngineOptions, "http" | "consoleFiles">;
  /** Browser push; the engine sends no browser a card when left out. */
  readonly webPush?: ComposeEngineOptions["webPush"];
  /** The agent runtime's running turns; none started when left out. */
  readonly turns?: ComposeEngineOptions["turns"];
  /** Handlers the test adds, such as the routed operations over a runtime of its own. */
  readonly handlers?: ComposeEngineOptions["handlers"];
  /** What tokens the registry does not list answer on chain; `UNL`, 18 decimals when left out. */
  readonly tokenFacts?: ComposeEngineOptions["readTokenFacts"];
  /** The agents' workspace files; in memory when left out. */
  readonly workspace?: ComposeEngineOptions["workspace"];
}

// The owner's bot and the handlers it alone runs, the HTTP listener with the console's files,
// browser push and the runtime's running turns, when the options name them.
function surfacesOf(
  options: SkeletonOptions,
): Pick<
  ComposeEngineOptions,
  "telegram" | "ownerChat" | "http" | "consoleFiles" | "webPush" | "turns"
> {
  const { telegram, ownerChat, webPush, turns } = options;
  return {
    ...(telegram === undefined ? {} : { telegram }),
    ...(turns === undefined ? {} : { turns }),
    ...(ownerChat === undefined ? {} : { ownerChat }),
    ...(webPush === undefined ? {} : { webPush }),
    ...options.browser,
  };
}

// The skeleton wallet's facts: 1 coin, a ceiling of 1 coin a transaction, a 1 gwei fee.
const facts = {
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 1_000_000_000n,
  networkFeeCapNativeBase: 1_000_000_000n,
  recentOutflows: [],
};

/**
 * `engine/status` and the operations beside it of an engine that is ready, unlocked and healthy,
 * release 2026.10.0, whose custody signs with no agent key of this machine.
 */
export function readyEngineOperations(
  stores: Pick<EngineParts["stores"], "agents" | "install">,
): EngineHandlerTable {
  return createEngineOperations({
    agents: stores.agents,
    install: stores.install,
    version: "2026.10.0",
    state: () => "ready",
    lock: { unlock: async () => Promise.resolve(ok(undefined)) },
    health: () => [],
    stop: () => undefined,
  });
}

/**
 * Composes the engine on the profile parts with its agent and tokens stored: the fake chain and
 * venue, a quote simulator, a manual clock and `engine/status` with no health signal. Nothing
 * listens yet.
 */
export async function composeSkeleton(
  parts: EngineParts,
  options: SkeletonOptions = {},
): Promise<ComposedSkeleton> {
  await seed(parts);
  const clock = createManualClock(testNowMs);
  const chains = createChainRegistry({
    chains: [options.fakeChain ?? createFakeChainDefinition(), ...(options.chains ?? [])],
    families: [createFakeFamily(), createEvmFamily()],
    signingSchemes: [createFakeSigningScheme(), createEvmSigningScheme()],
  });
  const positions = createMemoryPositionStore();
  const executor = createFakeExecutor();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const composed = composeEngine(parts, {
    chains,
    venues: options.venues ?? [createFakeVenue()],
    simulator: createQuoteSimulator(() => undefined),
    risk: {
      ...skeletonRisk,
      ...(options.chainSimulator === undefined ? {} : { simulator: options.chainSimulator }),
    },
    wallets: createFakeWalletFacts(new Map([[testAgent, [testWallet]]]), facts, options.held),
    executor,
    positions,
    canPrice: async () => await Promise.resolve(true),
    readTokenFacts: options.tokenFacts ?? createFakeTokenFacts().read,
    workspace: options.workspace ?? createMemoryWorkspaceFiles(clock),
    paperBalances: options.paperBalances ?? [{ asset: testCoin, base: 10n ** 18n }],
    version: "2026.10.0",
    owner: options.owner ?? (() => ({ locale: "en", timezone: "UTC" })),
    handlers: { ...readyEngineOperations(parts.stores), ...options.handlers },
    ...surfacesOf(options),
    clock,
    random: createSeededRandom(7),
    logger,
  });
  return { parts, composed, clock, positions, executor, logger };
}

/**
 * Starts the composed skeleton behind a loopback TCP stand-in for IPC, with a CLI client signed
 * in through the access store.
 */
export async function startSkeleton(
  parts: EngineParts,
  options: SkeletonOptions = {},
): Promise<Skeleton> {
  const skeleton = await composeSkeleton(parts, options);
  const served = await serveOnLoopback(skeleton.composed, {
    clock: skeleton.clock,
    cliSecret: skeletonSecrets.cli,
  });
  return { ...skeleton, ...served };
}
