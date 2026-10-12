import {
  BinferenceError,
  type Clock,
  err,
  type Id,
  type IdSource,
  ok,
  type Result,
} from "@binference/core";
import type { ProtocolErrorCode, UnfreezeRequest } from "@binference/protocol";
import type { AgentRecord } from "../agents/agent-record.js";
import type { InstallFacts } from "../install/install-record.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentProposerRef } from "../intents/intent-record.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { unfreezeQuoteDocument } from "../intents/unfreeze-quote.js";
import { openCardUnchecked } from "../money-path/open-card-unchecked.js";
import type { AgentStore, InstallStore } from "../ports.js";

/** What an unfreeze is planned and stored through. */
export interface UnfreezeProposalParts {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  readonly install: InstallStore;
  /** Whether the engine is locked: the auto test reads it, and an unfreeze's card asks either way. */
  readonly isLocked: () => boolean;
  readonly clock: Clock;
  readonly ids: IdSource;
}

/** What an unfreeze lifts, and the agent and wallet its intent is stored under. */
interface UnfreezePlan {
  readonly agents: readonly AgentRecord[];
  readonly isWholeInstall: boolean;
  readonly owner: { readonly agentId: Id<"agt">; readonly walletId: Id<"wal"> };
}

const isActive = (agent: AgentRecord): boolean => agent.archivedAtMs === undefined;
const isFrozen = (agent: AgentRecord): boolean => agent.frozenAtMs !== undefined;

// The agents an unfreeze names: the one asked for while it is frozen, or every frozen agent not
// archived; `undefined` when nothing it covers is frozen.
function frozenOf(
  records: readonly AgentRecord[],
  request: { readonly agent?: Id<"agt">; readonly installAtMs?: number },
): Result<readonly AgentRecord[] | undefined, ProtocolErrorCode> {
  const { agent } = request;
  if (agent === undefined) {
    const frozen = records.filter((record) => isActive(record) && isFrozen(record));
    return ok(frozen.length === 0 && request.installAtMs === undefined ? undefined : frozen);
  }
  const found = records.find((record) => record.id === agent);
  if (found === undefined) {
    return err("agent.not_found");
  }
  if (!isActive(found)) {
    return err("agent.archived");
  }
  return ok(isFrozen(found) ? [found] : undefined);
}

// The first agent it unfreezes that has a wallet, else any active agent's, with that wallet.
function ownerOf(
  records: readonly AgentRecord[],
  frozen: readonly AgentRecord[],
  facts: InstallFacts,
): UnfreezePlan["owner"] | undefined {
  const candidates = [...frozen, ...records.filter(isActive)];
  const wallets = facts.wallets.filter((wallet) => wallet.archivedAtMs === undefined);
  const owner = candidates.find((agent) => wallets.some(({ agentId }) => agentId === agent.id));
  const wallet = wallets.find(({ agentId }) => agentId === owner?.id);
  return owner === undefined || wallet === undefined
    ? undefined
    : { agentId: owner.id, walletId: wallet.id };
}

async function planOf(
  parts: UnfreezeProposalParts,
  agent: Id<"agt"> | undefined,
  signal: AbortSignal,
): Promise<Result<UnfreezePlan | undefined, ProtocolErrorCode>> {
  const [records, facts] = await Promise.all([
    parts.agents.list({ signal }),
    parts.install.read({ signal }),
  ]);
  const { frozenAtMs } = facts;
  const frozen = frozenOf(records, {
    ...(agent === undefined ? {} : { agent }),
    ...(frozenAtMs === undefined ? {} : { installAtMs: frozenAtMs }),
  });
  if (!frozen.ok || frozen.value === undefined) {
    return frozen.ok ? ok(undefined) : frozen;
  }
  const owner = ownerOf(records, frozen.value, facts);
  return owner === undefined
    ? err("agent.not_found")
    : ok({ agents: frozen.value, isWholeInstall: agent === undefined, owner });
}

async function create(
  parts: UnfreezeProposalParts,
  plan: UnfreezePlan,
  call: {
    readonly proposerRef: IntentProposerRef;
    readonly agent?: Id<"agt">;
    readonly signal: AbortSignal;
  },
): Promise<IntentSnapshot> {
  const machine = createIntentStateMachine({ clock: parts.clock });
  const step = machine.propose({
    kind: "unfreeze",
    proposer: "owner",
    isPaper: false,
    hasOutsideContent: false,
    agentStatus: "active",
  });
  const request: UnfreezeRequest = {
    kind: "unfreeze",
    ...(call.agent === undefined ? {} : { agent: call.agent }),
  };
  const intent = { id: parts.ids.next("int"), ...plan.owner, proposerRef: call.proposerRef };
  const created = step.ok
    ? await parts.stored.create({ ...intent, request, step: step.value }, { signal: call.signal })
    : undefined;
  if (created?.ok !== true) {
    throw new BinferenceError({
      code: "engine.unfreeze_not_stored",
      message: "A new unfreeze intent could not be stored.",
    });
  }
  return created.value;
}

/**
 * Stores an unfreeze of one agent, or of the whole install, and takes it to its card, which waits
 * for the owner's tap from any surface (decision 0128). Its quote names every frozen agent it
 * unfreezes and whether the install's freeze lifts too. It is stored live under the first agent it
 * unfreezes that has a wallet, or any active agent's, and that wallet. Answers `undefined`, storing
 * nothing, when nothing it covers is frozen. An unknown agent is `agent.not_found`, an archived
 * one `agent.archived`, and an install with no active agent holding a wallet `agent.not_found`.
 */
export async function proposeUnfreeze(
  parts: UnfreezeProposalParts,
  call: {
    readonly agent?: Id<"agt">;
    readonly proposerRef: IntentProposerRef;
    readonly signal: AbortSignal;
  },
): Promise<Result<IntentSnapshot | undefined, ProtocolErrorCode>> {
  const { signal } = call;
  const plan = await planOf(parts, call.agent, signal);
  if (!plan.ok || plan.value === undefined) {
    return plan.ok ? ok(undefined) : plan;
  }
  const { agents, isWholeInstall } = plan.value;
  const quote = {
    agents: agents.map(({ id, name }) => ({ agent: id, name })),
    isWholeInstall,
    quotedAtMs: parts.clock.now(),
  };
  const proposed = await create(parts, plan.value, call);
  const advance = { stored: parts.stored, machine: createIntentStateMachine(parts), signal };
  const { quotedAtMs } = quote;
  const encoded = unfreezeQuoteDocument.encode(quote);
  const run = { proposed, quote: encoded, quotedAtMs, isLocked: parts.isLocked() };
  return ok(await openCardUnchecked(advance, run));
}
