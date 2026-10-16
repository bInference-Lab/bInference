import type { ChainRegistry, Signer } from "@binference/chain";
import { BinferenceError, type Clock, err, type Id, ok, type Result } from "@binference/core";
import type { AgentView, ProtocolErrorCode } from "@binference/protocol";
import type { AgentMode, AgentRecord } from "../agents/agent-record.js";
import type { LimitsRecord } from "../agents/limits-record.js";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import { launchWalletOf } from "../install/launch-wallet.js";
import { launchRefusal } from "../limits/limit-handlers.js";
import type { AgentStore, ConfigJournal, InstallStore, WalletFactsSource } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { VenueHost } from "../venues/venue-host.js";
import { activeAgent } from "./active-agent.js";
import { agentViewOf } from "./agent-view-of.js";
import type { EngineCall, EngineHandler } from "./engine-call.js";

/** The handlers of the agent's mode switch (protocol spec, section 7.2). */
export interface AgentModeHandlers {
  readonly "agent/goLive": EngineHandler<"agent/goLive">;
  readonly "agent/goPaper": EngineHandler<"agent/goPaper">;
}

/** What the mode switch reads, writes and announces through. */
export interface AgentModeHandlersOptions {
  readonly agents: AgentStore;
  readonly journal: ConfigJournal;
  /** The live wallet facts, for the funding check before going live. */
  readonly wallets: WalletFactsSource;
  readonly custody: Signer;
  readonly chains: ChainRegistry;
  /** Which venues trade on contracts each launch has, which only a launch wallet may call. */
  readonly host: Pick<VenueHost, "hasLaunchContracts" | "launchCalls">;
  /** The install's wallets, among them the agent's launch wallet. */
  readonly install: Pick<InstallStore, "read">;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

type ModeCall = EngineCall<"agent/goLive"> | EngineCall<"agent/goPaper">;

interface Switching {
  readonly call: ModeCall;
  readonly mode: AgentMode;
  readonly attemptsLeft: number;
}

// Another write to the agent's row, such as a rename, makes a switch read the agent again.
const switchAttempts = 3;

// Funded: the agent's default wallet holds some of the native coin on a chain the registry holds.
async function isFunded(
  options: AgentModeHandlersOptions,
  agent: Id<"agt">,
  signal: AbortSignal,
): Promise<boolean> {
  const [wallet] = await options.wallets.wallets(agent, { signal });
  if (wallet === undefined) {
    return false;
  }
  const balances = await Promise.all(
    options.chains.list().map(async (chain) => {
      const account = await options.custody.account(wallet, chain.ref, { signal });
      if (!account.ok) {
        return 0n;
      }
      const query = { agent, wallet, account: account.value, isPaper: false };
      return (await options.wallets.facts(query, { signal })).nativeBalanceBase;
    }),
  );
  return balances.some((balance) => balance > 0n);
}

// Why the agent cannot go live with its venues, in effect or waiting: one trades on a launch's own
// contracts while the agent has no live launch wallet, which alone may call them (decision 0217),
// or while that wallet's ceiling lacks one of its launch calls (decision 0218).
async function launchVenueRefusal(
  options: AgentModeHandlersOptions,
  found: { readonly agent: AgentRecord; readonly limits: LimitsRecord },
  signal: AbortSignal,
): Promise<ProtocolErrorCode | undefined> {
  const { limits } = found;
  const named = [...limits.venues, ...(limits.pending?.values.venues ?? [])];
  const venues = named.filter((venue) => options.host.hasLaunchContracts(venue));
  if (venues.length === 0) {
    return undefined;
  }
  const launchWallet = await launchWalletOf(options.install, found.agent.id, { signal });
  return launchRefusal(options, { venues, launchWallet });
}

// Every mode change is journaled with who made it and where, and announced on the config topic.
async function journal(
  options: AgentModeHandlersOptions,
  call: ModeCall,
  change: { readonly before: AgentRecord; readonly after: AgentRecord },
): Promise<void> {
  await journalConfigChange(
    options,
    {
      author: authorOf(call.caller),
      atMs: change.after.changedAtMs,
      path: `agents.${change.after.name}.mode`,
      before: change.before.mode,
      after: change.after.mode,
    },
    { signal: call.signal },
  );
}

async function switchMode(
  options: AgentModeHandlersOptions,
  switching: Switching,
): Promise<Result<AgentView, ProtocolErrorCode>> {
  const { call, mode } = switching;
  const found = await activeAgent(options.agents, call.args.agent, { signal: call.signal });
  if (!found.ok || found.value.agent.mode === mode) {
    return found.ok ? ok(agentViewOf(found.value.agent)) : found;
  }
  const { agent } = found.value;
  const launchFailure =
    mode === "live" ? await launchVenueRefusal(options, found.value, call.signal) : undefined;
  if (launchFailure !== undefined) {
    return err(launchFailure);
  }
  if (mode === "live" && !(await isFunded(options, agent.id, call.signal))) {
    return err("wallet.unfunded");
  }
  const change = { agentId: agent.id, mode, atMs: options.clock.now() };
  const set = await options.agents.setMode(
    { ...change, expectedVersion: agent.version },
    { signal: call.signal },
  );
  if (set.ok) {
    await journal(options, call, { before: agent, after: set.value });
    return ok(agentViewOf(set.value));
  }
  if (switching.attemptsLeft <= 1) {
    throw new BinferenceError({
      code: "engine.agent_stale",
      message: `The mode of agent ${agent.id} kept changing under the switch.`,
      retryable: true,
      details: { agent: agent.id },
    });
  }
  return switchMode(options, { ...switching, attemptsLeft: switching.attemptsLeft - 1 });
}

/**
 * Creates the mode switch. `agent/goLive` is the only way an agent goes live: a loosening the
 * protocol server lets only an `admin` caller make over local IPC, such as `binference live`, and
 * only once the agent's default wallet holds funds (`wallet.unfunded` before) and its venues, in
 * effect or waiting, hold none that trades on a launch's own contracts unless it has a live launch
 * wallet (`limit.needs_launch_wallet`, decisions 0212 and 0217). `agent/goPaper`
 * brakes from any surface with `confirm`. Each switch keeps the intents already proposed as they
 * were stored, so a paper card still fills on paper; it is journaled and announced. Switching to
 * the mode an agent is in changes nothing.
 */
export function createAgentModeHandlers(options: AgentModeHandlersOptions): AgentModeHandlers {
  return {
    "agent/goLive": async (call) =>
      switchMode(options, { call, mode: "live", attemptsLeft: switchAttempts }),
    "agent/goPaper": async (call) =>
      switchMode(options, { call, mode: "paper", attemptsLeft: switchAttempts }),
  };
}
