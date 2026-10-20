import type { Venue } from "@binference/chain";
import { createEvmTxSimulator } from "@binference/chain-evm";
import type { Fork } from "@binference/chain-evm/fork";
import { createFakeRiskSource } from "@binference/chain/testing";
import { BinferenceError, type Clock } from "@binference/core";
import {
  createMemoryLogger,
  createMemoryWorkspaceFiles,
  createSeededRandom,
  type MemoryLogger,
} from "@binference/core/testing";
import type { EnginePush } from "@binference/engine";
import { createVenueHost } from "@binference/engine";
import { createRunningTurns, type RunningTurns } from "@binference/engine/chat";
import { createSourceMarketReads } from "@binference/engine/market";
import { createSimulationCheck } from "@binference/engine/simulation";
import {
  createFakeCeilingEditor,
  createFakePriceSource,
  createMemoryEngineStores,
  createMemoryPositionStore,
  createMemoryRiskCacheStore,
  type MemoryEngineStores,
} from "@binference/engine/testing";
import type { FlapApiFake } from "@binference/flap/testing";
import type { FakeBotApi } from "@binference/telegram/testing";
import { type ComposedEngine, composeEngine } from "../compose/compose-engine.js";
import type { ComposedTelegram, TelegramParts } from "../compose/compose-telegram.js";
import { type LoopbackServing, serveOnLoopback } from "../compose/loopback-serving.js";
import { selfHostedChains, selfHostedUnboundFirstBuys } from "../compose/open-engine-parts.js";
import {
  addSkeletonTokens,
  readyEngineOperations,
  skeletonSecrets,
} from "../compose/test-skeleton.js";
import { chainTokenCode } from "../compose/token-facts.js";
import { ownerBot, ownerId } from "../e2e/runtime-machine.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { flapOn } from "./flap-launch-parts.js";
import { forkTokenFacts } from "./fork-trading.js";
import {
  custodyOn,
  executorOf,
  type RigCustody,
  rigPrices,
  signerOver,
  walletFactsOn,
  walletMakerOf,
} from "./launch-wallet-parts.js";
import { type LaunchAgent, setUpLaunchAgent } from "./launch-wallet-rig.js";

/**
 * The engine on a fork as `binference start` composes it, with the owner's bot on the synthetic
 * Bot API, the protocol server the runtime signs in to, custody on the Privy fake signed for by the
 * real signer process, Flap launching through a fake of its API, and the live agent with its main
 * and launch wallets.
 */
export interface LaunchChatMachine extends LoopbackServing, LaunchAgent {
  readonly composed: ComposedEngine;
  readonly bot: ComposedTelegram;
  readonly botApi: FakeBotApi;
  readonly stores: MemoryEngineStores;
  readonly server: ComposedEngine["server"];
  readonly turns: RunningTurns;
  readonly clock: Clock;
  readonly logger: MemoryLogger;
  readonly custody: RigCustody;
  /** Stops the clients, the bot's relays, the server and the signer process. */
  stop(): Promise<void>;
}

// The profile parts on the fork: custody of the agent's wallets on the Privy fake, the rig's
// prices, a risk source with nothing to report (a launch runs no risk step) and no market data.
function partsOn(
  fork: Fork,
  custody: RigCustody,
  made: { readonly stores: MemoryEngineStores; readonly maker: ReturnType<typeof walletMakerOf> },
) {
  const clock = createSystemClock();
  const source = createFakeRiskSource({ id: "goplus", reports: new Map() });
  return {
    custody: signerOver(custody),
    ceilings: createFakeCeilingEditor({ clock }),
    walletMaker: made.maker,
    stores: made.stores,
    prices: createFakePriceSource(rigPrices(fork)),
    riskSources: [{ source, isRequired: true }],
    marketReads: createSourceMarketReads({ sources: [], clock, timeoutMs: 5_000 }),
  };
}

/** What the machine is made from: the fork, the signer's bundle and Flap's API fake. */
export interface LaunchChatRun {
  readonly entry: string;
  readonly api: FlapApiFake;
}

/** What the machine's engine is composed from, before it serves. */
interface Made {
  readonly fork: Fork;
  readonly stores: MemoryEngineStores;
  readonly custody: RigCustody;
  readonly venues: readonly Venue[];
  readonly maker: ReturnType<typeof walletMakerOf>;
  readonly telegram: TelegramParts;
  readonly turns: RunningTurns;
  readonly logger: MemoryLogger;
}

// The engine as `binference start` composes it on the fork, its executor's pushes reaching the
// composed engine's publish as the self-hosted composition's do.
function composedOn(made: Made): ComposedEngine {
  const { fork, stores, custody, venues, telegram, turns, logger } = made;
  const clock = createSystemClock();
  const chains = selfHostedChains();
  const positions = createMemoryPositionStore();
  const wallets = walletFactsOn(fork, stores);
  const host = createVenueHost({ venues, chains, clock, callTimeoutMs: 15_000 });
  const pushes = { publish: (_push: EnginePush): void => undefined };
  const custodian = signerOver(custody);
  const rig = { fork, stores, positions, custody: custodian, wallets, venues, host, covered: [] };
  const executor = executorOf({ ...rig, publish: (push) => pushes.publish(push) });
  const simulator = createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain });
  const composed = composeEngine(partsOn(fork, custody, made), {
    chains,
    unboundFirstBuys: selfHostedUnboundFirstBuys(),
    venues,
    simulator: createSimulationCheck({ simulator, chains, clock }),
    risk: { cache: createMemoryRiskCacheStore(["goplus"]), cacheTtlMs: () => 600_000, simulator },
    wallets,
    executor,
    positions,
    paperBalances: [],
    version: "2026.10.0",
    owner: () => ({ locale: "en", timezone: "UTC" }),
    canPrice: async () => await Promise.resolve(true),
    readTokenFacts: forkTokenFacts(fork),
    readTokenCode: chainTokenCode(new Map([[fork.chain.ref, { rpc: fork.rpc }]])),
    workspace: createMemoryWorkspaceFiles(clock),
    handlers: readyEngineOperations(stores),
    turns,
    telegram,
    clock,
    random: createSeededRandom(59),
    logger,
  });
  pushes.publish = composed.publish;
  return composed;
}

// Serves the composed engine with the CLI token, and sets the agent's install up on it.
async function served(made: Made, botApi: FakeBotApi, signal: AbortSignal) {
  const composed = composedOn(made);
  const { stores, custody, maker, fork } = made;
  await addSkeletonTokens({ stores });
  const install = { fork, stores, maker, engine: composed.engine, custody, venues: ["flap"] };
  const agent = await setUpLaunchAgent(install, signal);
  const clock = createSystemClock();
  const serving = await serveOnLoopback(composed, { clock, cliSecret: skeletonSecrets.cli });
  const bot = composed.telegram;
  if (bot === undefined) {
    throw new BinferenceError({ code: "fork.no_bot", message: "The engine serves the bot." });
  }
  const stop = async () => {
    await serving.close();
    await custody.signer.stop(AbortSignal.timeout(5_000));
  };
  const { server } = composed;
  const { turns, logger } = made;
  return {
    ...serving,
    ...agent,
    composed,
    bot,
    botApi,
    stores,
    server,
    turns,
    clock,
    logger,
    custody,
    stop,
  };
}

/**
 * Composes and serves the engine on the fork with the owner's bot, in English in UTC, and sets up
 * the live agent trading on Flap alone. A machine that fails to start stops its signer; a test
 * stops it with {@link LaunchChatMachine.stop} once done.
 */
export async function startLaunchChatMachine(
  fork: Fork,
  run: LaunchChatRun,
  signal: AbortSignal,
): Promise<LaunchChatMachine> {
  const stores = createMemoryEngineStores();
  const custody = await custodyOn(fork, run.entry, signal);
  const venues = [flapOn(fork, run.api)];
  const maker = walletMakerOf(custody, { stores, venues });
  const bot = await ownerBot();
  const { botApi } = bot;
  // One owner record, as the self-hosted engine keeps it: the bot's and the engine's draft desk's.
  await stores.owners.bind({ userId: ownerId, pairedAtMs: 1 }, { signal });
  const telegram = { ...bot.telegram, owners: stores.owners };
  const turns = createRunningTurns();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const made = { fork, stores, custody, venues, maker, telegram, turns, logger };
  try {
    return await served(made, botApi, signal);
  } catch (error) {
    await custody.signer.stop(AbortSignal.abort());
    throw error;
  }
}
