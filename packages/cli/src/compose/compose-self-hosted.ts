import type { ChainRegistry, Signer } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { type EnginePush, signerStoppedNotice } from "@binference/engine";
import type { RunningExecutor } from "@binference/engine/executor";
import type { EngineState } from "@binference/protocol";
import type { OperationHandlers, ProtocolServer } from "@binference/server";
import { type ComposedCustody, composeCustody } from "./compose-custody.js";
import { composeEngine } from "./compose-engine.js";
import { composeExecutor } from "./compose-executor.js";
import { type ComposedLock, composeLock } from "./compose-lock.js";
import { createEngineOperations } from "./engine-operations.js";
import { type HealthSignal, startHealthProbe } from "./health-signals.js";
import { createMissingParts, type MissingParts } from "./missing-parts.js";
import { type Opened, type Opening, selfHostedChains } from "./open-engine-parts.js";
import { selfHostedRiskSources } from "./risk-sources.js";

/** The self-hosted engine, built and not yet listening. */
export interface ComposedSelfHosted {
  readonly server: ProtocolServer;
  readonly executor: RunningExecutor;
  /** Takes the confirmed intents the lock held; logs a failure and never rejects. */
  readonly resume: (signal: AbortSignal) => Promise<void>;
  /** The call that `engine/stop` makes once the shutdown sequence exists. */
  readonly stopper: { stop: () => void };
  /** `starting` until the startup order ends, then `ready`. */
  readonly state: { current: EngineState };
  readonly locked: ComposedLock;
}

const loopback = "127.0.0.1";

// The executor sends through the chains' relays; its pushes reach the engine's once it exists.
function composeSending(
  opening: Opening,
  opened: Opened,
  context: {
    readonly parts: MissingParts;
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
    config: config.chains,
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
  readonly missing: MissingParts["missing"];
  /** The executor's health signal. */
  readonly executor: () => HealthSignal["state"];
  /** The custody signal: ok while custody is open, failing while the engine is locked. */
  readonly custody: () => HealthSignal["state"];
}

// The engine's own operations: its status with the health signals, its stop and its unlock.
function engineHandlers(opening: Opening, opened: Opened, wiring: EngineWiring): OperationHandlers {
  const probe = startHealthProbe({
    missing: wiring.missing,
    parts: [
      { signal: "executor", state: wiring.executor },
      { signal: "custody", state: wiring.custody },
    ],
    logFailed: opened.log.hasFailed,
  });
  opening.closers.add("health", async () => probe.stop());
  return createEngineOperations({
    agents: opened.stores.agents,
    version: opening.host.version,
    state: wiring.locked.state,
    lock: wiring.locked.lock,
    health: () => probe.read(),
    stop: () => wiring.stopper.stop(),
  });
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
  readonly parts: MissingParts;
  readonly chains: ChainRegistry;
  readonly custody: ComposedCustody;
  readonly sending: ReturnType<typeof composeSending>;
  readonly resume: (signal: AbortSignal) => Promise<void>;
  readonly locked: ComposedLock;
  readonly stopper: { stop: () => void };
  /** What a signer that stops by itself sets off, once the server can say so. */
  readonly signerStopped: { run: () => void };
}

function composeParts(opening: Opening, opened: Opened): Wiring {
  const { host, platform } = opening;
  const state: { current: EngineState } = { current: "starting" };
  const parts = createMissingParts();
  const chains = selfHostedChains();
  const signerStopped = { run: (): void => undefined };
  const custody = composeCustody(opening, opened, {
    chains,
    onStopped: () => signerStopped.run(),
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
  return { state, parts, chains, custody, sending, resume, locked, stopper, signerStopped };
}

// The engine and its protocol server over the wired parts.
function composeServing(opening: Opening, opened: Opened, wiring: Wiring) {
  const { host } = opening;
  const { config, log, stores } = opened;
  const { parts, custody, sending, locked } = wiring;
  return composeEngine(
    {
      custody: custody.cell.signer,
      ceilings: custody.cell.ceilings,
      stores,
      prices: parts.prices,
      riskSources: selfHostedRiskSources(host.http),
    },
    {
      chains: wiring.chains,
      venues: [],
      simulator: parts.simulator,
      risk: {
        cache: stores.riskCache,
        cacheTtlMs: config.risk.cacheTtlSec * 1_000,
        simulator: parts.txSimulator,
      },
      wallets: parts.wallets,
      version: host.version,
      owner: config.owner,
      http: { host: loopback, port: config.engine.port, extraOrigins: config.engine.extraOrigins },
      state: locked.state,
      isLocked: () => locked.lock.isLocked(),
      handlers: engineHandlers(opening, opened, {
        missing: parts.missing,
        executor: sending.health,
        custody: () => (custody.cell.isOpen() ? "ok" : "fail"),
        stopper: wiring.stopper,
        locked,
      }),
      clock: host.clock,
      random: host.random,
      logger: log.logger,
      executor: sending.executor,
      positions: parts.positions,
      // No agent holds a wallet until the wallet facts adapter exists, so a paper reset has nowhere
      // to place the starting balance yet.
      paperBalances: [],
    },
  );
}

/**
 * Builds the self-hosted engine on its opened config, log and stores: custody, empty until the
 * lock opens it; the executor over the chains' RPCs and relays; the lock over the install's keys;
 * the engine with the missing parts; and its protocol server, which answers `engine.starting`
 * until the startup order ends. A signer that stops by itself locks the engine again, and every
 * surface hears it. Each part adds its closer, so the shutdown sequence closes the server first,
 * then lets the executor finish what it signs and sends, then stops the signer.
 */
export function composeSelfHosted(opening: Opening, opened: Opened): ComposedSelfHosted {
  const wiring = composeParts(opening, opened);
  const { sending, locked, state, stopper, resume } = wiring;
  const { server, publish } = composeServing(opening, opened, wiring);
  sending.pushes.publish = publish;
  locked.announce.publish = publish;
  wiring.signerStopped.run = () => {
    locked.lock.lock();
    opened.log.logger.error("engine.signer_stopped");
    publish({ topic: "engine", kind: "engine/state", data: { state: locked.state() } });
    publish(signerStoppedNotice());
  };
  const { executor } = sending;
  return { server, executor, resume, stopper, state, locked };
}
