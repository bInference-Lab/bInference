import type { NameResolver } from "@binference/chain";
import { createEvmTxSimulator } from "@binference/chain-evm";
import type { Fork } from "@binference/chain-evm/fork";
import { createFakeRiskSource } from "@binference/chain/testing";
import { BinferenceError } from "@binference/core";
import {
  createMemoryLogger,
  createMemoryWorkspaceFiles,
  createSeededRandom,
  type MemoryLogger,
} from "@binference/core/testing";
import type { EnginePush } from "@binference/engine";
import {
  type AgentInboxMessage,
  createRunningTurns,
  type RunningTurns,
} from "@binference/engine/chat";
import { createSourceMarketReads } from "@binference/engine/market";
import { createSimulationCheck } from "@binference/engine/simulation";
import {
  createFakeCeilingEditor,
  createFakeWalletMaker,
  createMemoryPositionStore,
  createMemoryRiskCacheStore,
  type MemoryEngineStores,
} from "@binference/engine/testing";
import type { FakeBotApi } from "@binference/telegram/testing";
import { composeChainReads } from "../compose/chain-reads.js";
import { type ComposedEngine, composeEngine } from "../compose/compose-engine.js";
import type { ComposedTelegram } from "../compose/compose-telegram.js";
import { type LoopbackServing, serveOnLoopback } from "../compose/loopback-serving.js";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { selfHostedBridging } from "../compose/self-hosted-bridging.js";
import {
  addSkeletonTokens,
  readyEngineOperations,
  skeletonSecrets,
} from "../compose/test-skeleton.js";
import { ownerBot, ownerId } from "../e2e/runtime-machine.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { type BridgeArrivals, createBridgeArrivals } from "./bridge-arrivals.js";
import { forkTokenFacts } from "./fork-trading.js";
import { type RescueRigParts, rescueRigParts } from "./rescue-rig-parts.js";
import { spaceIdOn } from "./space-id-names.js";

/**
 * The engine on a fork as `binference start` composes it for sends and bridges, with the owner's
 * bot on the synthetic Bot API and the protocol server the runtime signs in to: the rescue rig's
 * live agent with its main and bridge wallets, SPACE ID's names on the fork, and Across and Relay
 * over their live APIs, whose deliveries the test lands.
 */
export interface SendBridgeMachine extends LoopbackServing {
  readonly composed: ComposedEngine;
  readonly bot: ComposedTelegram;
  readonly botApi: FakeBotApi;
  readonly stores: MemoryEngineStores;
  readonly server: ComposedEngine["server"];
  readonly turns: RunningTurns;
  readonly clock: ReturnType<typeof createSystemClock>;
  readonly logger: MemoryLogger;
  readonly rig: RescueRigParts;
  readonly arrivals: BridgeArrivals;
  /** Stops the clients, the bot's relays and the server. */
  stop(): Promise<void>;
}

// The bridging parts `binference start` composes, over the fork's BSC and the arrivals' network.
function bridgingOn(fork: Fork, arrivals: BridgeArrivals) {
  const { http } = arrivals;
  const clock = createSystemClock();
  const config = {
    enabled: [fork.chain.ref],
    rpc: { [fork.chain.ref]: { urls: [fork.rpcUrl] } },
    relays: {},
    maxFeePerGasGwei: { [fork.chain.ref]: "10" },
  };
  const reads = composeChainReads({ chains: selfHostedChains(), config, http, clock });
  return selfHostedBridging({ http, clock, reads });
}

// The profile parts on the fork: the rig's custody, stores and prices, a risk source with nothing
// to report (a send or a bridge runs no risk step) and no market data.
function partsOf(fork: Fork, rig: RescueRigParts) {
  const clock = createSystemClock();
  const source = createFakeRiskSource({ id: "goplus", reports: new Map() });
  return {
    custody: rig.custody,
    ceilings: createFakeCeilingEditor({ clock }),
    walletMaker: createFakeWalletMaker({ clock, chain: fork.chain.ref, family: "evm" }),
    stores: rig.stores,
    prices: rig.prices,
    riskSources: [{ source, isRequired: true }],
    marketReads: createSourceMarketReads({ sources: [], clock, timeoutMs: 5_000 }),
  };
}

/** What the engine is composed from besides the fork. */
interface Made {
  readonly rig: RescueRigParts;
  readonly names: NameResolver;
  readonly bridging: ReturnType<typeof bridgingOn>;
  readonly telegram: Awaited<ReturnType<typeof ownerBot>>["telegram"];
  readonly turns: RunningTurns;
  readonly logger: MemoryLogger;
}

function composedOn(fork: Fork, made: Made): ComposedEngine {
  const { rig, names, bridging, telegram, turns, logger } = made;
  const clock = createSystemClock();
  const chains = selfHostedChains();
  const pushes = {
    publish: (_push: EnginePush): void => undefined,
    settled: (_message: AgentInboxMessage): void => undefined,
  };
  const simulator = createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain });
  const composed = composeEngine(partsOf(fork, rig), {
    chains,
    venues: [],
    simulator: createSimulationCheck({ simulator, chains, clock }),
    risk: { cache: createMemoryRiskCacheStore(["goplus"]), cacheTtlMs: () => 600_000, simulator },
    wallets: rig.wallets,
    executor: rig.executor({
      publish: (push) => pushes.publish(push),
      settled: (message) => pushes.settled(message),
    }),
    positions: createMemoryPositionStore(),
    paperBalances: [],
    version: "2026.10.0",
    owner: () => ({ locale: "en", timezone: "UTC" }),
    canPrice: async () => await Promise.resolve(true),
    readTokenFacts: forkTokenFacts(fork),
    workspace: createMemoryWorkspaceFiles(clock),
    handlers: readyEngineOperations(rig.stores),
    turns,
    telegram,
    nameResolvers: [names],
    destinations: bridging.engine.destinations,
    bridging: bridging.engine,
    clock,
    random: createSeededRandom(34),
    logger,
  });
  pushes.publish = composed.publish;
  pushes.settled = composed.engine.pushSettled;
  return composed;
}

/**
 * Composes and serves the engine on the fork with the owner's bot, in English in UTC, over the
 * rescue rig's parts; a test stops it with {@link SendBridgeMachine.stop} once done.
 */
export async function startSendBridgeMachine(
  fork: Fork,
  signal: AbortSignal,
): Promise<SendBridgeMachine> {
  const arrivals = createBridgeArrivals(fork);
  const bridging = bridgingOn(fork, arrivals);
  const names = spaceIdOn(fork);
  const rig = await rescueRigParts(fork, { nameResolvers: [names], bridging });
  const owned = await ownerBot();
  // One owner record, as the self-hosted engine keeps it: the bot's and the engine's.
  await rig.stores.owners.bind({ userId: ownerId, pairedAtMs: 1 }, { signal });
  const telegram = { ...owned.telegram, owners: rig.stores.owners };
  const turns = createRunningTurns();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const composed = composedOn(fork, { rig, names, bridging, telegram, turns, logger });
  await addSkeletonTokens({ stores: rig.stores });
  const clock = createSystemClock();
  const serving = await serveOnLoopback(composed, { clock, cliSecret: skeletonSecrets.cli });
  const bot = composed.telegram;
  if (bot === undefined) {
    throw new BinferenceError({ code: "fork.no_bot", message: "The engine serves the bot." });
  }
  const { stores } = rig;
  const { server } = composed;
  const stop = async () => serving.close();
  return {
    ...serving,
    composed,
    bot,
    botApi: owned.botApi,
    stores,
    server,
    turns,
    clock,
    logger,
    rig,
    arrivals,
    stop,
  };
}
