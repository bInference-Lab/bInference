import {
  BinferenceError,
  type Clock,
  err,
  type Id,
  type IdSource,
  ok,
  type Result,
} from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { AgentRecord } from "../agents/agent-record.js";
import type { ConfigAuthor } from "../audit/journal-config-change.js";
import type { StoredFreeze, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { statesBeforeSigning } from "../intents/transition-table.js";
import type { LedgerDraft } from "../ledger/ledger-entry.js";
import type { AgentStore, InstallStore, IntentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that announces a frozen agent (spec 4, section 4). */
export const frozenNoticeKey = "notice.frozen";

/** What a freeze reads and writes through, and where its notices go. */
export interface FreezeAgentsOptions {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  readonly intents: IntentStore;
  readonly install: InstallStore;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly publish: PublishPush;
}

/** Which agents a freeze stops: one, or every agent not archived when absent; and who asked. */
export interface FreezeRequest {
  readonly agent?: Id<"agt">;
  readonly author: ConfigAuthor;
}

// A freeze reads again and writes again when another write moved a row it read; five rounds
// outlast any burst of moves a running engine makes, and a freeze never gives up quietly.
const maxRounds = 5;
const pageSize = 1_000;

// The agents a freeze stops: every one not archived for the whole install, none of them needed.
function targetsOf(
  records: readonly AgentRecord[],
  agent: Id<"agt"> | undefined,
): Result<readonly AgentRecord[], ProtocolErrorCode> {
  if (agent === undefined) {
    return ok(records.filter((record) => record.archivedAtMs === undefined));
  }
  const found = records.find((record) => record.id === agent);
  if (found === undefined) {
    return err("agent.not_found");
  }
  return found.archivedAtMs === undefined ? ok([found]) : err("agent.archived");
}

// Every intent of the agent that nothing has signed yet, a page at a time.
async function unsignedOf(
  intents: IntentStore,
  agentId: Id<"agt">,
  call: { readonly signal: AbortSignal; readonly after?: IntentRecord },
): Promise<readonly IntentRecord[]> {
  const { signal, after } = call;
  const query = {
    states: statesBeforeSigning,
    agentId,
    limit: pageSize,
    ...(after === undefined ? {} : { after: { changedAtMs: after.changedAtMs, id: after.id } }),
  };
  const page = await intents.list(query, { signal });
  const last = page.at(-1);
  return page.length < pageSize || last === undefined
    ? page
    : [...page, ...(await unsignedOf(intents, agentId, { signal, after: last }))];
}

// The move of each unsigned intent to `cancelled`. A rescue stays (decision 0099), and so does
// one another write moved past signing since it was listed.
async function cancelMoves(
  options: FreezeAgentsOptions,
  records: readonly IntentRecord[],
  call: { readonly by: string; readonly signal: AbortSignal },
): Promise<readonly IntentMove[]> {
  const machine = createIntentStateMachine({ clock: options.clock });
  const trigger = { type: "cancel_requested", cause: "freeze", hasSignedStep: false } as const;
  const moves = await Promise.all(
    records
      .filter(({ kind }) => kind !== "rescue")
      .map(async (record): Promise<readonly IntentMove[]> => {
        const snapshot = await options.stored.snapshot(record.id, { signal: call.signal });
        const step =
          snapshot === undefined ? undefined : machine.apply(snapshot.stored.status, trigger);
        return snapshot === undefined || step?.ok !== true
          ? []
          : [
              {
                intent: record.id,
                version: snapshot.stored.version,
                step: step.value,
                by: call.by,
              },
            ];
      }),
  );
  return moves.flat();
}

// A `freeze` entry about one agent, or about the whole install without one.
function freezeEntry(
  options: FreezeAgentsOptions,
  agent: AgentRecord | undefined,
  stamp: { readonly atMs: number; readonly author: ConfigAuthor },
): LedgerDraft {
  const { atMs, author } = stamp;
  return {
    id: options.ids.next("led"),
    atMs,
    ...(agent === undefined ? {} : { agentId: agent.id, subject: agent.id }),
    kind: "freeze",
    data: { by: author.by, surface: author.surface },
  };
}

// The latest time any of the agents, or the install a whole-install freeze marks, was frozen.
function frozenAtOf(
  targets: readonly AgentRecord[],
  marked: { readonly agents: readonly AgentRecord[]; readonly installAtMs: number | undefined },
): number {
  const times = targets.map(
    (target) =>
      marked.agents.find((agent) => agent.id === target.id)?.frozenAtMs ?? target.frozenAtMs ?? 0,
  );
  return Math.max(...times, marked.installAtMs ?? 0);
}

/** What one round of a freeze read: the agents it stops, their moves, and the install's freeze. */
interface FreezePlan {
  readonly targets: readonly AgentRecord[];
  readonly moves: readonly IntentMove[];
  readonly isWholeInstall: boolean;
  /** When the install was frozen before, for a whole-install freeze. */
  readonly installAtMs?: number;
}

async function planOf(
  options: FreezeAgentsOptions,
  request: FreezeRequest,
  signal: AbortSignal,
): Promise<Result<FreezePlan, ProtocolErrorCode>> {
  const targets = targetsOf(await options.agents.list({ signal }), request.agent);
  if (!targets.ok) {
    return targets;
  }
  const listed = await Promise.all(
    targets.value.map(async (agent) => unsignedOf(options.intents, agent.id, { signal })),
  );
  const moves = await cancelMoves(options, listed.flat(), { by: request.author.by, signal });
  const isWholeInstall = request.agent === undefined;
  const installAtMs = isWholeInstall
    ? (await options.install.read({ signal })).frozenAtMs
    : undefined;
  return ok({
    targets: targets.value,
    moves,
    isWholeInstall,
    ...(installAtMs === undefined ? {} : { installAtMs }),
  });
}

// The write of one round: the agents it marks, the install for a first whole-install freeze, the
// moves, and an entry for each it marks.
function writeOf(
  options: FreezeAgentsOptions,
  plan: FreezePlan & { readonly unfrozen: readonly AgentRecord[]; readonly author: ConfigAuthor },
): StoredFreeze {
  const { unfrozen, author, isWholeInstall, moves } = plan;
  const atMs = options.clock.now();
  const agents = unfrozen.map((agent) => ({ agentId: agent.id, expectedVersion: agent.version }));
  const stamp = { atMs, author };
  const entries = unfrozen.map((agent) => freezeEntry(options, agent, stamp));
  const marksInstall = isWholeInstall && plan.installAtMs === undefined;
  const ledger = marksInstall ? [...entries, freezeEntry(options, undefined, stamp)] : entries;
  return { atMs, isFrozen: true, agents, isWholeInstall, moves, ledger };
}

function announce(
  options: FreezeAgentsOptions,
  unfrozen: readonly AgentRecord[],
  author: ConfigAuthor,
): void {
  for (const agent of unfrozen) {
    const values = { agent: agent.name, surface: author.surface };
    options.publish(noticePush({ key: frozenNoticeKey, agent: agent.id, values }));
  }
}

/** One round: read the agents and their unsigned intents, then write the freeze, or `stale`. */
async function freezeOnce(
  options: FreezeAgentsOptions,
  request: FreezeRequest,
  signal: AbortSignal,
): Promise<Result<number, ProtocolErrorCode | "stale">> {
  const plan = await planOf(options, request, signal);
  if (!plan.ok) {
    return plan;
  }
  const { targets, moves, isWholeInstall, installAtMs } = plan.value;
  const unfrozen = targets.filter((agent) => agent.frozenAtMs === undefined);
  const isMarked = !isWholeInstall || installAtMs !== undefined;
  if (unfrozen.length === 0 && moves.length === 0 && isMarked) {
    return ok(frozenAtOf(targets, { agents: [], installAtMs }));
  }
  const write = writeOf(options, { ...plan.value, unfrozen, author: request.author });
  const commit = await options.stored.freeze(write, { signal });
  if (!commit.ok) {
    return commit;
  }
  announce(options, unfrozen, request.author);
  const installAt = isWholeInstall ? (installAtMs ?? write.atMs) : undefined;
  return ok(frozenAtOf(targets, { agents: commit.value.agents, installAtMs: installAt }));
}

async function freezeFrom(
  options: FreezeAgentsOptions,
  at: { readonly request: FreezeRequest; readonly round: number },
  signal: AbortSignal,
): Promise<Result<number, ProtocolErrorCode>> {
  const frozen = await freezeOnce(options, at.request, signal);
  if (frozen.ok) {
    return frozen;
  }
  if (frozen.error !== "stale") {
    return err(frozen.error);
  }
  if (at.round >= maxRounds) {
    throw new BinferenceError({
      code: "engine.freeze_contended",
      message: `Other writes moved the rows a freeze read ${String(maxRounds)} times in a row.`,
      retryable: true,
    });
  }
  return freezeFrom(options, { ...at, round: at.round + 1 }, signal);
}

/**
 * Freezes one agent, or the whole install (ARCHITECTURE.md section 11), in one write: it marks
 * each agent frozen and cancels every intent of theirs that nothing has signed, a rescue excepted
 * (decision 0099); an intent being signed or sent runs to its end. A whole-install freeze stops
 * every agent not archived and marks the install frozen too, so every agent created later starts
 * frozen until an unfreeze. Each newly frozen agent is announced with `notice.frozen`. An agent or
 * an install frozen before keeps its time, and a freeze that finds nothing to change writes
 * nothing. It answers when the freeze took effect: the latest time any of the agents, or the
 * install, was frozen. An unknown agent is `agent.not_found` and an archived one
 * `agent.archived`. A write another write beat is read and tried again.
 */
export async function freezeAgents(
  options: FreezeAgentsOptions,
  request: FreezeRequest,
  signal: AbortSignal,
): Promise<Result<number, ProtocolErrorCode>> {
  return freezeFrom(options, { request, round: 1 }, signal);
}
