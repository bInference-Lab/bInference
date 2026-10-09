import type { ChainRef, ChainRegistry } from "@binference/chain";
import type { EnginePush } from "@binference/engine";
import type { RunningExecutor } from "@binference/engine/executor";
import type { EngineState } from "@binference/protocol";
import type { OperationHandlers, ProtocolServer } from "@binference/server";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { composeEngine } from "./compose-engine.js";
import { composeExecutor } from "./compose-executor.js";
import { type ComposedLock, composeLock, type SetUpInstall } from "./compose-lock.js";
import { createEngineOperations } from "./engine-operations.js";
import { type HealthSignal, startHealthProbe } from "./health-signals.js";
import { createMissingParts, type MissingParts } from "./missing-parts.js";
import {
  type OpenedLog,
  type OpenedStores,
  type Opening,
  selfHostedChains,
} from "./open-engine-parts.js";
import { selfHostedRiskSources } from "./risk-sources.js";

/** What the engine is built from once the config, the log and the store are open. */
export interface Opened {
  readonly config: BinferenceConfig;
  readonly log: OpenedLog;
  readonly stores: OpenedStores;
  /** The install, or `undefined` before `binference init` set it up. */
  readonly install: SetUpInstall | undefined;
  /** The owner's tracing RPC of each chain config names one for, read from its secret. */
  readonly tracers: ReadonlyMap<ChainRef, string>;
}

/** The self-hosted engine, built and not yet listening. */
export interface ComposedSelfHosted {
  readonly server: ProtocolServer;
  readonly executor: RunningExecutor;
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
  context: { readonly parts: MissingParts; readonly chains: ChainRegistry },
) {
  const { host, closers } = opening;
  const { config, log, stores } = opened;
  const { parts, chains } = context;
  const pushes = { publish: (_push: EnginePush): void => undefined };
  const composed = composeExecutor({
    stores,
    tracers: opened.tracers,
    positions: parts.positions,
    custody: parts.custody,
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
}

// The engine's own operations: its status with the health signals, its stop and its unlock.
function engineHandlers(opening: Opening, opened: Opened, wiring: EngineWiring): OperationHandlers {
  const probe = startHealthProbe({
    missing: wiring.missing,
    parts: [{ signal: "executor", state: wiring.executor }],
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

/**
 * Builds the self-hosted engine on its opened config, log and stores: the executor over the
 * chains' RPCs and relays, the lock over the install's keys, the engine with the missing parts,
 * and its protocol server, which answers `engine.starting` until the startup order ends. Each
 * part adds its closer, so the shutdown sequence closes the server first, then lets the executor
 * finish what it signs and sends.
 */
export function composeSelfHosted(opening: Opening, opened: Opened): ComposedSelfHosted {
  const { host, platform } = opening;
  const { config, log, stores } = opened;
  const state: { current: EngineState } = { current: "starting" };
  const parts = createMissingParts();
  const riskSources = selfHostedRiskSources(host.http);
  const chains = selfHostedChains();
  const sending = composeSending(opening, opened, { parts, chains });
  const locked = composeLock({ host, platform, config, install: opened.install, started: state });
  const stopper = { stop: (): void => undefined };
  const { server, publish } = composeEngine(
    { custody: parts.custody, ceilings: parts.ceilings, stores, prices: parts.prices, riskSources },
    {
      chains,
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
        stopper,
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
  sending.pushes.publish = publish;
  locked.announce.publish = publish;
  return { server, executor: sending.executor, stopper, state, locked };
}
