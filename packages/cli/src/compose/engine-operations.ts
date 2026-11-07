import { BinferenceError, createSecret, ok } from "@binference/core";
import type { AgentStore } from "@binference/engine";
import { authorOf } from "@binference/engine/audit";
import type { InstallStore } from "@binference/engine/install";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { engineDebugSwitch } from "@binference/plugin-host";
import { type EngineState, protocolVersion, type ResultOf } from "@binference/protocol";
import type { EngineLock } from "../unlock/engine-lock.js";
import type { LockReason } from "../unlock/unlock-keys.js";
import type { EngineRestart } from "./engine-restart.js";
import type { HealthSignal } from "./health-signals.js";

/** What the engine's own operations read and do. */
export interface EngineOperationsOptions {
  readonly agents: Pick<AgentStore, "list" | "get">;
  /** The install's wallets, whose launch wallets the status names. */
  readonly install: Pick<InstallStore, "read">;
  /** The engine's release. */
  readonly version: string;
  readonly state: () => EngineState;
  /** Opens the agent key for `engine/unlock`. */
  readonly lock: Pick<EngineLock, "unlock">;
  readonly health: () => readonly HealthSignal[];
  /** The Node options the engine's process runs with, which `debugSignalOff` reads. */
  readonly nodeOptions: readonly string[];
  /** Whether a community plugin is on, which keeps auto mode asking (decision 0350). */
  readonly communityPluginsOn: () => boolean;
  /**
   * Starts the shutdown sequence. It must not wait for the sequence: the sequence closes the
   * server that answers the call.
   */
  readonly stop: () => void;
  /** Restarts the engine (decision 0395): a record for the next start, then the shutdown sequence. */
  readonly restart: Pick<EngineRestart, "request">;
}

type EngineStatus = ResultOf<"engine/status">;

// A call sent again unchanged cannot pass for these: it needs another passphrase, a restart, or
// this machine attached again.
const finalReasons: ReadonlySet<LockReason> = new Set([
  "needs_passphrase",
  "wrong_passphrase",
  "app_secret_missing",
  "signer_revoked",
  "update_checking",
]);

// The handler's answer carries no details, so the refusal travels as the protocol code it is.
function lockedFault(reason: LockReason): BinferenceError {
  return new BinferenceError({
    code: "engine.locked",
    message: `The agent key did not open: ${reason}.`,
    retryable: !finalReasons.has(reason),
    details: { reason },
  });
}

type Wallets = Awaited<ReturnType<InstallStore["read"]>>["wallets"];

// Each agent that is not archived, with its live launch wallet (decision 0217) and bridge wallet
// (decision 0307) when it has them.
function agentsOf(
  records: Awaited<ReturnType<AgentStore["list"]>>,
  wallets: Wallets,
): EngineStatus["agents"] {
  return records
    .filter((record) => record.archivedAtMs === undefined)
    .map((record) => {
      const live = wallets.filter(
        (wallet) => wallet.agentId === record.id && wallet.archivedAtMs === undefined,
      );
      const launch = live.find((wallet) => wallet.role === "launch");
      const bridge = live.find((wallet) => wallet.role === "bridge");
      const agent = { id: record.id, mode: record.mode, frozen: record.frozenAtMs !== undefined };
      return Object.assign(
        agent,
        launch === undefined ? {} : { launchWallet: launch.id },
        bridge === undefined ? {} : { bridgeWallet: bridge.id },
      );
    });
}

// While a community plugin is on, each agent in auto mode says that every proposal asks
// (decision 0350).
async function withAutoAsks(
  options: EngineOperationsOptions,
  agents: EngineStatus["agents"],
  signal: AbortSignal,
): Promise<EngineStatus["agents"]> {
  if (!options.communityPluginsOn()) {
    return agents;
  }
  return Promise.all(
    agents.map(async (agent) => {
      const settings = await options.agents.get(agent.id, { signal });
      const auto = settings?.approvalMode.mode === "auto";
      return auto ? { ...agent, autoAsks: "plugin" as const } : agent;
    }),
  );
}

/**
 * The handlers of `engine/status`, `engine/stop` and `engine/unlock`. Status answers the state, the
 * release, the protocol version, the agents that are not archived with their launch and bridge wallets
 * and whether a community plugin keeps their auto mode asking,
 * the health signals and whether the engine runs with its debug signal off; the
 * engine counts as frozen when it has agents and every one of them is frozen. Stop starts the
 * shutdown sequence and answers at once. Unlock opens the agent key, with the passphrase in the
 * `manual` mode, and fails with `engine.locked` and the reason in `details.reason` while it stays
 * locked (decision 0104).
 */
export function createEngineOperations(options: EngineOperationsOptions): EngineHandlerTable {
  return {
    "engine/status": async ({ signal }) => {
      const [records, install] = await Promise.all([
        options.agents.list({ signal }),
        options.install.read({ signal }),
      ]);
      const agents = await withAutoAsks(options, agentsOf(records, install.wallets), signal);
      return ok({
        state: options.state(),
        version: options.version,
        protocol: protocolVersion,
        frozen: agents.length > 0 && agents.every((agent) => agent.frozen),
        agents,
        health: options.health(),
        debugSignalOff: options.nodeOptions.includes(engineDebugSwitch),
      });
    },
    "engine/unlock": async ({ args, signal }) => {
      const { passphrase } = args;
      const typed = passphrase === undefined ? {} : { passphrase: createSecret(passphrase) };
      const unlocked = await options.lock.unlock({ ...typed, signal });
      if (!unlocked.ok) {
        throw lockedFault(unlocked.error);
      }
      return ok({});
    },
    "engine/restart": async ({ caller, signal }) => {
      await options.restart.request({ reason: "owner", surface: authorOf(caller).surface }, signal);
      return ok({});
    },
    "engine/stop": async () => {
      options.stop();
      return Promise.resolve(ok({}));
    },
  };
}
