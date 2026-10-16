import { type AssetRef, canonicalAsset, type ChainRegistry } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  err,
  jsonValueSchema,
  ok,
  type Result,
} from "@binference/core";
import {
  type LimitChanges as WireChanges,
  limitsViewSchema,
  type LimitsView,
  type ProtocolErrorCode,
} from "@binference/protocol";
import { z } from "zod";
import type { AgentMode, AgentSettings } from "../agents/agent-record.js";
import { type LimitsRecord, limitsValuesOf } from "../agents/limits-record.js";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import type { WalletRecord } from "../install/install-record.js";
import { launchWalletIn } from "../install/launch-wallet.js";
import { activeAgent } from "../operations/active-agent.js";
import { answererOf, type EngineCall, type EngineHandler } from "../operations/engine-call.js";
import {
  cancelLimits,
  isSameLimits,
  type LimitsState,
  limitsAt,
  moveLimits,
} from "../policy/limit-change.js";
import type { AgentStore, ConfigJournal, InstallStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { VenueHost } from "../venues/venue-host.js";
import {
  launchVenuesOutsideCeiling,
  unknownVenues,
  venuesOutsideCeiling,
} from "./limit-ceiling.js";
import { limitNotices } from "./limit-notices.js";
import { limitChangesOf, limitsViewOf, reservesAsked } from "./limit-views.js";

/** The handlers of an agent's limits (protocol spec, section 7.6; decision 0111). */
export interface LimitHandlers {
  readonly "limit/get": EngineHandler<"limit/get">;
  readonly "limit/set": EngineHandler<"limit/set">;
  readonly "limit/cancelPending": EngineHandler<"limit/cancelPending">;
}

/** What the limit handlers read, write, check against and announce through. */
export interface LimitHandlersOptions {
  readonly agents: AgentStore;
  /** The wallets, whose ceilings bound the venues an agent may add. */
  readonly install: InstallStore;
  /** Which venues trade on contracts each launch has, which no ceiling can list. */
  readonly host: Pick<VenueHost, "hasLaunchContracts" | "launchCalls">;
  readonly journal: ConfigJournal;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

type LimitsCall = EngineCall<"limit/set"> | EngineCall<"limit/cancelPending">;

type Decide = (
  state: LimitsState,
  nowMs: number,
  mode: AgentMode,
) => Promise<Result<LimitsState, ProtocolErrorCode>>;

/** The limits as written after a move, and the state they hold. */
interface Moved {
  readonly record: LimitsRecord;
  readonly state: LimitsState;
}

// Another write to the limits, such as a change from another surface, makes a move read again.
const moveAttempts = 3;

function stateOf(record: LimitsRecord): LimitsState {
  const values = limitsValuesOf(record);
  return record.pending === undefined ? { values } : { values, pending: record.pending };
}

function isSameState(left: LimitsState, right: LimitsState): boolean {
  const [a, b] = [left.pending, right.pending];
  const isSamePending =
    a === undefined || b === undefined
      ? a === b
      : a.atMs === b.atMs && isSameLimits(a.values, b.values);
  return isSamePending && isSameLimits(left.values, right.values);
}

function wireOf(view: LimitsView) {
  return jsonValueSchema.parse(z.encode(limitsViewSchema, view));
}

// Every move is journaled with who made it and where, pushed on the config topic, and announced
// to the owner as notices on every surface.
async function announce(
  options: LimitHandlersOptions,
  planned: {
    readonly call: LimitsCall;
    readonly settings: AgentSettings;
    readonly before: LimitsState;
  },
  after: Moved,
): Promise<void> {
  const { call, settings, before } = planned;
  const mover = { agent: settings.agent.id, surface: answererOf(call.caller).surface };
  await journalConfigChange(
    options,
    {
      author: authorOf(call.caller),
      atMs: after.record.changedAtMs,
      path: `agents.${settings.agent.name}.limits`,
      before: wireOf(limitsViewOf(settings.limits, before)),
      after: wireOf(limitsViewOf(after.record, after.state)),
      notices: limitNotices(mover, before, after.state),
    },
    { signal: call.signal },
  );
}

interface Moving {
  readonly call: LimitsCall;
  readonly decide: Decide;
  readonly attemptsLeft: number;
}

async function move(
  options: LimitHandlersOptions,
  { call, decide, attemptsLeft }: Moving,
): Promise<Result<Moved, ProtocolErrorCode>> {
  const found = await activeAgent(options.agents, call.args.agent, { signal: call.signal });
  if (!found.ok) {
    return found;
  }
  const nowMs = options.clock.now();
  const { limits } = found.value;
  const before = limitsAt(stateOf(limits), nowMs);
  const next = await decide(stateOf(limits), nowMs, found.value.agent.mode);
  if (!next.ok || isSameState(next.value, before)) {
    return next.ok ? ok({ record: limits, state: before }) : next;
  }
  const { values, pending } = next.value;
  const change = { agentId: limits.agentId, limits: values, atMs: nowMs };
  const set = await options.agents.setLimits(
    { ...change, ...(pending === undefined ? {} : { pending }), expectedVersion: limits.version },
    { signal: call.signal },
  );
  if (set.ok) {
    const moved = { record: set.value, state: next.value };
    await announce(options, { call, settings: found.value, before }, moved);
    return ok(moved);
  }
  if (attemptsLeft <= 1) {
    throw new BinferenceError({
      code: "engine.agent_stale",
      message: `The limits of agent ${limits.agentId} kept changing under the move.`,
      retryable: true,
      details: { agent: limits.agentId },
    });
  }
  return move(options, { call, decide, attemptsLeft: attemptsLeft - 1 });
}

/**
 * Why a live agent cannot use venues that trade on a launch's own contracts (decisions 0217 and
 * 0218): it has no live launch wallet, or that wallet's ceiling lacks one of their launch calls.
 */
export function launchRefusal(
  options: { readonly host: Pick<VenueHost, "launchCalls"> },
  check: { readonly venues: readonly string[]; readonly launchWallet: WalletRecord | undefined },
): ProtocolErrorCode | undefined {
  const { venues, launchWallet } = check;
  if (launchWallet === undefined) {
    return "limit.needs_launch_wallet";
  }
  const launchCalls = (venue: string) => options.host.launchCalls(venue);
  const outside = launchVenuesOutsideCeiling({ venues, launchWallet, launchCalls });
  return outside.length > 0 ? "limit.over_ceiling" : undefined;
}

// A venue or chain the registry lacks is malformed. A venue that trades on a launch's own
// contracts needs a launch wallet to trade live, whose ceiling allows the calls of every launchpad
// the install runs (decision 0217): a live agent without one cannot add it, one whose launch
// wallet's ceiling lacks its launch calls waits for the owner key (decision 0218), and a paper
// agent adds it with no ceiling to check. Any other venue a live
// wallet's ceiling leaves out waits for the owner key, which alone adds it to the ceiling.
async function refusalOf(
  options: LimitHandlersOptions,
  call: EngineCall<"limit/set">,
  agent: { readonly venues: readonly string[]; readonly mode: AgentMode },
): Promise<ProtocolErrorCode | undefined> {
  const { changes } = call.args;
  const added = (changes.venues ?? []).filter((venue) => !agent.venues.includes(venue));
  const unknownChain = reservesAsked(changes).some((item) => !options.chains.get(item.chain).ok);
  if (unknownChain || unknownVenues(options.chains, added).length > 0) {
    return "protocol.bad_args";
  }
  const launched = added.filter((venue) => options.host.hasLaunchContracts(venue));
  const { wallets } = await options.install.read({ signal: call.signal });
  const launchWallet = launchWalletIn(wallets, call.args.agent);
  if (launched.length > 0 && agent.mode === "live") {
    const refusal = launchRefusal(options, { venues: launched, launchWallet });
    if (refusal !== undefined) {
      return refusal;
    }
  }
  const ceilinged = added.filter((venue) => !launched.includes(venue));
  if (ceilinged.length === 0) {
    return undefined;
  }
  const check = { agent: call.args.agent, venues: ceilinged, wallets, chains: options.chains };
  return venuesOutsideCeiling(check).length > 0 ? "limit.over_ceiling" : undefined;
}

// Each token of a list takes its family's canonical form, so the policy matches every spelling of
// it and a list holds it once.
function canonicalTokens(
  chains: ChainRegistry,
  tokens: readonly AssetRef[] | undefined,
): Result<readonly AssetRef[] | undefined, "protocol.bad_args"> {
  if (tokens === undefined) {
    return ok(undefined);
  }
  const canonical = tokens.map((token) => canonicalAsset(chains, token));
  return canonical.every((token) => token.ok)
    ? ok([...new Set(canonical.flatMap((token) => (token.ok ? [token.value] : [])))])
    : err("protocol.bad_args");
}

function canonicalChanges(
  chains: ChainRegistry,
  changes: WireChanges,
): Result<WireChanges, "protocol.bad_args"> {
  const allow = canonicalTokens(chains, changes.allowTokens);
  const deny = canonicalTokens(chains, changes.denyTokens);
  if (!allow.ok || !deny.ok) {
    return err("protocol.bad_args");
  }
  return ok({
    ...changes,
    ...(allow.value === undefined ? {} : { allowTokens: allow.value }),
    ...(deny.value === undefined ? {} : { denyTokens: deny.value }),
  });
}

function setDecision(options: LimitHandlersOptions, call: EngineCall<"limit/set">): Decide {
  return async (state, nowMs, mode) => {
    const { values } = limitsAt(state, nowMs);
    const changes = canonicalChanges(options.chains, call.args.changes);
    const agent = { venues: values.venues, mode };
    const refusal = changes.ok ? await refusalOf(options, call, agent) : changes.error;
    if (!changes.ok || refusal !== undefined) {
      return err(refusal ?? "protocol.bad_args");
    }
    const { next, looser } = moveLimits(state, limitChangesOf(changes.value, values), nowMs);
    return call.caller.scopes.includes(looser.length > 0 ? "loosen" : "confirm")
      ? ok(next)
      : err("auth.scope");
  };
}

/**
 * Creates the limit handlers. `limit/get` answers the limits in effect, as the policy holds every
 * intent to them, and the looser ones that wait. `limit/set` applies at once, with the `confirm`
 * scope, each change that is clearly stricter or back to the value in effect, and drops any looser
 * value of that limit that waits; every other change needs the `loosen` scope and waits 24 hours
 * (decision 0111). A venue that trades on a launch's own contracts is `limit.needs_launch_wallet`
 * for a live agent without a launch wallet, and needs no ceiling for a paper one or one with a
 * launch wallet (decisions 0212 and 0217); any other venue a live wallet's ceiling leaves out is
 * `limit.over_ceiling`. The token
 * lists keep each token in its family's canonical form; a token without one is
 * `protocol.bad_args`.
 * `limit/cancelPending` drops the looser limits that wait. Each move is journaled, pushed as
 * `config/changed`, and announced as `notice.limitChange` and `notice.limitChangeCancelled`
 * notices.
 */
export function createLimitHandlers(options: LimitHandlersOptions): LimitHandlers {
  const answer = async (call: LimitsCall, decide: Decide) => {
    const moved = await move(options, { call, decide, attemptsLeft: moveAttempts });
    return moved.ok ? ok(limitsViewOf(moved.value.record, moved.value.state)) : moved;
  };
  return {
    async "limit/get"({ args, signal }) {
      const found = await activeAgent(options.agents, args.agent, { signal });
      if (!found.ok) {
        return found;
      }
      const { limits } = found.value;
      return ok(limitsViewOf(limits, limitsAt(stateOf(limits), options.clock.now())));
    },
    async "limit/set"(call) {
      return answer(call, setDecision(options, call));
    },
    async "limit/cancelPending"(call) {
      return answer(call, async (state, nowMs) => Promise.resolve(ok(cancelLimits(state, nowMs))));
    },
  };
}
