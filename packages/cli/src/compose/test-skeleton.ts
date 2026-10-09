import { once } from "node:events";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import {
  type AccountRef,
  accountRefSchema,
  createChainRegistry,
  type Venue,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigner,
  createFakeSigningScheme,
  createFakeVenue,
} from "@binference/chain/testing";
import { createProtocolClient, type ProtocolClient } from "@binference/client";
import { BinferenceError, idSchema, ok } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
  type ManualClock,
  type MemoryLogger,
} from "@binference/core/testing";
import { type PositionStore, sha256Hex } from "@binference/engine";
import {
  createFakeExecutor,
  createFakePriceSource,
  createFakeWalletFacts,
  createMemoryEngineStores,
  createMemoryPositionStore,
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
import { type ClientKind, operations } from "@binference/protocol";
import { WebSocket } from "ws";
import { composeCloudTestRoot } from "./cloud-test-root.js";
import { type ComposedEngine, composeEngine, type EngineParts } from "./compose-engine.js";
import type { TelegramParts } from "./compose-telegram.js";
import { createEngineOperations } from "./engine-operations.js";

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

/** The two compositions: the self-hosted one and the Cloud-shaped test root. */
export const skeletonCompositions: readonly SkeletonComposition[] = [
  {
    // The self-hosted root's custody and Chainlink price adapters stand in as fakes here.
    name: "self-hosted",
    parts: () => ({
      custody: createFakeSigner(wallets),
      stores: withTestWallet(createMemoryEngineStores()),
      prices: createFakePriceSource(new Map([[testCoin, coinPrice]])),
    }),
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

async function addToken(parts: EngineParts, kind: "cli" | "mcp", n: number): Promise<void> {
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

// The engine's test agent, on paper in manual mode, the CLI token and the MCP token.
async function seed(parts: EngineParts): Promise<void> {
  const created = await parts.stores.agents.create(testAgentDraft(), live());
  if (!created.ok) {
    throw new BinferenceError({ code: "test.seed_failed", message: "The agent is stored." });
  }
  await addToken(parts, "cli", 1);
  await addToken(parts, "mcp", 2);
}

async function listenOnLoopback(server: NetServer): Promise<number> {
  server.listen({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const bound = server.address();
  return bound !== null && typeof bound === "object" ? bound.port : 0;
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
export interface Skeleton extends ComposedSkeleton {
  /** The owner's CLI, signed in with every scope. */
  readonly client: ProtocolClient;
  /** Opens another client over the IPC stand-in, signed in with a token's secret. */
  connect(secret: string, kind?: ClientKind): Promise<ProtocolClient>;
  /** Closes every client, the relay to Telegram, the IPC stand-in and the server. */
  close(): Promise<void>;
}

/** What a skeleton adds to its profile parts. */
export interface SkeletonOptions {
  /** The owner's bot; without it the skeleton serves no Telegram. */
  readonly telegram?: TelegramParts;
  /** The venues the engine trades on; the fake venue alone when left out. */
  readonly venues?: readonly Venue[];
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
    chains: [createFakeChainDefinition()],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
  const facts = {
    nativeBalanceBase: 10n ** 18n,
    ceilingPerTxNativeBase: 10n ** 18n,
    feePerGasNativeBase: 1_000_000_000n,
    networkFeeCapNativeBase: 1_000_000_000n,
    recentOutflows: [],
  };
  const positions = createMemoryPositionStore();
  const executor = createFakeExecutor();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const composed = composeEngine(parts, {
    chains,
    venues: options.venues ?? [createFakeVenue()],
    simulator: createQuoteSimulator(() => undefined),
    wallets: createFakeWalletFacts(new Map([[testAgent, [testWallet]]]), facts),
    executor,
    positions,
    paperBalances: [{ asset: testCoin, base: 10n ** 18n }],
    version: "2026.10.0",
    owner: { locale: "en", timezone: "UTC" },
    handlers: createEngineOperations({
      agents: parts.stores.agents,
      version: "2026.10.0",
      state: () => "ready",
      // The skeleton's custody signs with no agent key of this machine, so nothing is locked.
      lock: { unlock: async () => Promise.resolve(ok(undefined)) },
      health: () => [],
      stop: () => undefined,
    }),
    ...(options.telegram === undefined ? {} : { telegram: options.telegram }),
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
  const { composed, clock } = skeleton;
  // The platform's IPC endpoint hands its sockets to the server the same way.
  const ipc = createNetServer((socket) => composed.server.acceptIpc(socket));
  const port = await listenOnLoopback(ipc);
  const clients: ProtocolClient[] = [];
  const connect = async (secret: string, kind: ClientKind = "cli"): Promise<ProtocolClient> => {
    const opened = createProtocolClient({
      operations,
      openSocket: () => new WebSocket(`ws://127.0.0.1:${String(port)}/ws`),
      client: { kind, version: "test" },
      credential: { token: secret },
      clock,
      random: createSeededRandom(11 + clients.length),
      logger: createMemoryLogger({ subsystem: "client" }),
    });
    clients.push(opened);
    await opened.connect(AbortSignal.timeout(10_000));
    return opened;
  };
  const client = await connect(skeletonSecrets.cli);
  return {
    ...skeleton,
    client,
    connect,
    async close() {
      clients.forEach((opened) => opened.close());
      await composed.telegram?.close();
      ipc.close();
      await composed.server.close();
    },
  };
}
