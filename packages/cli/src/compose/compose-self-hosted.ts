import type { Amount, ChainRef, ChainRegistry, PriceSource, Signer } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import {
  type Engine,
  type EnginePush,
  type PositionStore,
  signerStoppedNotice,
  type WalletFactsSource,
} from "@binference/engine";
import { type RunningExecutor, signerRefusedNotice } from "@binference/engine/executor";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { EngineState } from "@binference/protocol";
import type { ProtocolServer } from "@binference/server";
import type { SignerRefusalNotice } from "@binference/signer";
import { isPublicEndpoint } from "../runtime/public-address.js";
import { composeBackupOperations } from "./backup-operations.js";
import { composePrices } from "./chain-prices.js";
import { type ChainReads, composeChainReads, rpcHealthOf } from "./chain-reads.js";
import { type ComposedSimulators, composeSimulators } from "./chain-simulators.js";
import { createChainWalletFacts } from "./chain-wallet-facts.js";
import { type ComposedCustody, composeCustody } from "./compose-custody.js";
import { composeEngine } from "./compose-engine.js";
import { composeExecutor } from "./compose-executor.js";
import { type ComposedLock, composeLock } from "./compose-lock.js";
import type { ComposedTelegram } from "./compose-telegram.js";
import { createEngineOperations } from "./engine-operations.js";
import { type HealthSignal, startHealthProbe } from "./health-signals.js";
import { botParts } from "./open-bot.js";
import { type Opened, type Opening, selfHostedFeeds } from "./open-engine-parts.js";
import { ownerChatHandlers } from "./owner-locale-change.js";
import { paperBalancesOf } from "./paper-balances.js";
import { publishedParts } from "./published-parts.js";
import { selfHostedRiskSources } from "./risk-sources.js";
import { type SealKeyKeeper, sealKeyOf } from "./seal-key-keeper.js";
import { createTelegramPair } from "./telegram-pair.js";

/** The self-hosted engine, built and not yet listening. */
export interface ComposedSelfHosted {
  readonly server: ProtocolServer;
  /** Where the engine's pushes go: the server, and the owner's bot when there is one. */
  readonly publish: (push: EnginePush) => void;
  readonly executor: RunningExecutor;
  /** The work that waits for its time, such as a rescue address's ceiling change. */
  readonly settle: Engine["settle"];
  /** Reads every live wallet's gas and raises the low-gas alert. */
  readonly checkGas: Engine["checkGas"];
  /** Records the positions a crash kept from recent paper fills. */
  readonly repairPaperFills: Engine["repairPaperFills"];
  /** Takes the confirmed intents the lock held; logs a failure and never rejects. */
  readonly resume: (signal: AbortSignal) => Promise<void>;
  /** The call that `engine/stop` makes once the shutdown sequence exists. */
  readonly stopper: { stop: () => void };
  /** `starting` until the startup order ends, then `ready`. */
  readonly state: { current: EngineState };
  readonly locked: ComposedLock;
  /** The owner's bot joined to the engine, when its token was read. */
  readonly telegram?: ComposedTelegram;
}

/** What the self-hosted engine trades on, each part over the chains' one set of reads. */
interface TradingParts {
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  /** Chainlink feeds (decision 0059). */
  readonly prices: PriceSource;
  /** The install's wallets with their balances, fees and ceilings read on chain. */
  readonly wallets: WalletFactsSource;
  /** `eth_simulateV1`, and the engine's simulation check over it. */
  readonly simulators: ComposedSimulators;
  /** The positions on `engine.sqlite`. */
  readonly positions: PositionStore;
  /** What a paper portfolio starts with: config's `defaults.paper.balances`. */
  readonly paperBalances: readonly Amount[];
}

function composeTrading(opening: Opening, opened: Opened): TradingParts {
  const { clock, http } = opening.host;
  const { config, stores, chains } = opened;
  const reads = composeChainReads({ chains, config: config.chains, http, clock });
  const { install, intents, positions } = stores;
  return {
    reads,
    prices: composePrices(reads, { feeds: selfHostedFeeds(), clock }),
    wallets: createChainWalletFacts({ install, intents, reads, clock }),
    simulators: composeSimulators(reads, { chains, clock }),
    positions,
    paperBalances: paperBalancesOf(config.defaults.paper.balances, reads),
  };
}

// The executor sends through the chains' relays; its pushes reach the engine's once it exists.
function composeSending(
  opening: Opening,
  opened: Opened,
  context: {
    readonly parts: TradingParts;
    readonly custody: Signer;
    readonly chains: ChainRegistry;
  },
) {
  const { host, closers } = opening;
  const { config, log, stores } = opened;
  const { parts, chains } = context;
  const pushes = { publish: (_push: EnginePush): void => undefined };
  const composed = composeExecutor({
    stores,
    tracers: opened.tracers,
    positions: parts.positions,
    custody: context.custody,
    wallets: parts.wallets,
    prices: parts.prices,
    chains,
    venues: opened.venues,
    reads: parts.reads,
    relays: config.chains.relays,
    http: host.http,
    clock: host.clock,
    random: host.random,
    publish: (push) => {
      pushes.publish(push);
    },
    logger: log.logger,
  });
  // The executor finishes a signature or a send under way within the shutdown's budget.
  closers.add("executor", async (signal) => composed.executor.close({ signal }));
  return { ...composed, pushes };
}

/** What the engine's own operations answer from besides the stores. */
interface EngineWiring extends Pick<ComposedSelfHosted, "stopper" | "locked"> {
  /** Where a long job's end goes, once the engine's publish exists. */
  readonly jobs: { publish: (push: EnginePush) => void };
  /** The `rpc` health signal: how the chains' RPC endpoints answered. */
  readonly rpc: () => HealthSignal["state"];
  /** The executor's health signal. */
  readonly executor: () => HealthSignal["state"];
  /** The custody signal: ok while custody is open, failing while the engine is locked. */
  readonly custody: () => HealthSignal["state"];
  /** The backup key signal: a warning while backups are still sealed to the owner key itself. */
  readonly backupKey: () => HealthSignal["state"];
}

// The engine's own operations: its status with the health signals, its stop, its unlock, a new
// pairing link for the owner's bot, and the backups.
function engineHandlers(
  opening: Opening,
  opened: Opened,
  wiring: EngineWiring,
): EngineHandlerTable {
  const probe = startHealthProbe({
    parts: [
      { signal: "executor", state: wiring.executor },
      { signal: "custody", state: wiring.custody },
      { signal: "rpc", state: wiring.rpc },
      { signal: "backup_key", state: wiring.backupKey },
    ],
    logFailed: opened.log.hasFailed,
  });
  opening.closers.add("health", async () => probe.stop());
  const { clock, random } = opening.host;
  return {
    ...createEngineOperations({
      agents: opened.stores.agents,
      version: opening.host.version,
      state: wiring.locked.state,
      lock: wiring.locked.lock,
      health: () => probe.read(),
      stop: () => wiring.stopper.stop(),
    }),
    ...createTelegramPair({ api: opened.bot?.api, access: opened.stores.access, clock, random }),
    ...composeBackupOperations(opening, opened, (push) => wiring.jobs.publish(push)),
  };
}

// The confirmed intents an earlier run left wait for the keys (decision 0103); once the engine
// holds them, the executor takes them, after the intents recovery put in their queues.
function resumeOf(opened: Opened, executor: RunningExecutor) {
  return async (signal: AbortSignal): Promise<void> => {
    try {
      await executor.takeConfirmed({ signal });
    } catch (error) {
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      opened.log.logger.error("engine.resume_failed", { errorCode });
    }
  };
}

/** The parts the server is built over, before it exists. */
interface Wiring {
  readonly state: { current: EngineState };
  readonly parts: TradingParts;
  readonly chains: ChainRegistry;
  readonly custody: ComposedCustody;
  readonly sending: ReturnType<typeof composeSending>;
  readonly resume: (signal: AbortSignal) => Promise<void>;
  readonly locked: ComposedLock;
  readonly stopper: { stop: () => void };
  /** What a signer that stops by itself sets off, once the server can say so. */
  readonly signerStopped: { run: () => void };
  /** What a step the signer refused sets off, once the server can say so. */
  readonly signerRefused: { run: (notice: SignerRefusalNotice) => void };
  /** Where a long job's end goes, once the server can say so. */
  readonly jobs: { publish: (push: EnginePush) => void };
  /** Whether backups are sealed to the sealing key yet, and the owner key hook that moves them. */
  readonly sealKey: SealKeyKeeper;
}

function composeParts(opening: Opening, opened: Opened): Wiring {
  const { host, platform } = opening;
  const state: { current: EngineState } = { current: "starting" };
  const parts = composeTrading(opening, opened);
  const { chains } = opened;
  const signerStopped = { run: (): void => undefined };
  const signerRefused = { run: (_notice: SignerRefusalNotice): void => undefined };
  const sealKey = sealKeyOf(opened);
  const custody = composeCustody(opening, opened, {
    chains,
    onStopped: () => signerStopped.run(),
    onRefusal: (notice) => signerRefused.run(notice),
    sealKey,
  });
  const sending = composeSending(opening, opened, { parts, custody: custody.cell.signer, chains });
  const resume = resumeOf(opened, sending.executor);
  const locked = composeLock({
    host,
    platform,
    config: opened.config,
    install: opened.install,
    started: state,
    openCustody: custody.open,
    resume,
  });
  const stopper = { stop: (): void => undefined };
  const jobs = { publish: (_push: EnginePush): void => undefined };
  return {
    jobs,
    state,
    parts,
    chains,
    custody,
    sending,
    resume,
    locked,
    stopper,
    signerStopped,
    signerRefused,
    sealKey,
  };
}

// The custody parts the engine takes, from the custody cell that the lock opens.
function custodyPartsOf(custody: ComposedCustody) {
  const { signer, ceilings, walletMaker, exporter, revoker } = custody.cell;
  return { custody: signer, ceilings, walletMaker, exporter, revoker };
}

// The engine and its protocol server over the wired parts.
function composeServing(opening: Opening, opened: Opened, wiring: Wiring) {
  const { host } = opening;
  const { config, log, stores } = opened;
  const { parts, custody, sending, locked } = wiring;
  const bot = opened.bot === undefined ? undefined : botParts(opened.bot, stores);
  return composeEngine(
    {
      ...custodyPartsOf(custody),
      stores,
      prices: parts.prices,
      riskSources: selfHostedRiskSources(host.http),
    },
    {
      chains: wiring.chains,
      venues: opened.venues,
      simulator: parts.simulators.simulator,
      risk: {
        cache: stores.riskCache,
        cacheTtlMs: config.risk.cacheTtlSec * 1_000,
        simulator: parts.simulators.txSimulator,
      },
      wallets: parts.wallets,
      version: host.version,
      owner: () => opened.settings.current().owner,
      ...publishedParts(config, bot),
      ...(opened.consoleFiles === undefined ? {} : { consoleFiles: opened.consoleFiles }),
      state: locked.state,
      isLocked: () => locked.lock.isLocked(),
      ownerChat: ownerChatHandlers(opening.platform, opened.settings),
      ...(opened.webPushKey === undefined
        ? {}
        : { webPush: { key: opened.webPushKey, http: host.http, isPublicEndpoint } }),
      handlers: engineHandlers(opening, opened, {
        rpc: () => rpcHealthOf(parts.reads, host.clock),
        executor: sending.health,
        custody: () => (custody.cell.isOpen() ? "ok" : "fail"),
        backupKey: () => (wiring.sealKey.isSealed() ? "ok" : "warn"),
        stopper: wiring.stopper,
        locked,
        jobs: wiring.jobs,
      }),
      clock: host.clock,
      random: host.random,
      logger: log.logger,
      executor: sending.executor,
      positions: parts.positions,
      paperBalances: parts.paperBalances,
    },
  );
}

/**
 * Builds the self-hosted engine on its opened config, log and stores: custody, empty until the
 * lock opens it; one RPC failover per chain, which the prices, the wallet facts, the simulators and
 * the executor's reads share; the executor over it and the chains' relays; the lock over the
 * install's keys; the engine over the venues, those parts and the stored positions; and its
 * protocol server, which answers `engine.starting`
 * until the startup order ends. A signer that stops by itself locks the engine again, and every
 * surface hears it. Each part adds its closer, so the shutdown sequence closes the server first,
 * then lets the executor finish what it signs and sends, then stops the signer.
 */
export function composeSelfHosted(opening: Opening, opened: Opened): ComposedSelfHosted {
  const wiring = composeParts(opening, opened);
  const { sending, locked, state, stopper, resume } = wiring;
  const { engine, server, publish, telegram, webPush } = composeServing(opening, opened, wiring);
  if (telegram !== undefined) {
    // The bot's line to the chat closes after the server, so nothing new reaches it, and before
    // the store; notices published later wait in the outbox for the next start.
    opening.closers.add("telegram", async () => telegram.close());
  }
  if (webPush !== undefined) {
    // As the bot's line: after the server, before the store it drops gone subscriptions from.
    opening.closers.add("web_push", async () => webPush.close());
  }
  sending.pushes.publish = publish;
  locked.announce.publish = publish;
  wiring.jobs.publish = publish;
  wiring.signerRefused.run = ({ intent, refused }) => {
    publish(signerRefusedNotice({ intent, refused }));
  };
  wiring.signerStopped.run = () => {
    locked.lock.lock();
    opened.log.logger.error("engine.signer_stopped");
    publish({ topic: "engine", kind: "engine/state", data: { state: locked.state() } });
    publish(signerStoppedNotice());
  };
  const { executor } = sending;
  const bot = telegram === undefined ? {} : { telegram };
  return {
    server,
    publish,
    executor,
    settle: engine.settle,
    checkGas: engine.checkGas,
    repairPaperFills: engine.repairPaperFills,
    resume,
    stopper,
    state,
    locked,
    ...bot,
  };
}
