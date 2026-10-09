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
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { statesBeforeSigning } from "../intents/transition-table.js";
import type { LedgerDraft } from "../ledger/ledger-entry.js";
import type { AgentStore, IntentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that announces a frozen agent (spec 4, section 4). */
export const frozenNoticeKey = "notice.frozen";

/** What a freeze reads and writes through, and where its notices go. */
export interface FreezeAgentsOptions {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  readonly intents: IntentStore;
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

function targetsOf(
  records: readonly AgentRecord[],
  agent: Id<"agt"> | undefined,
): Result<readonly AgentRecord[], ProtocolErrorCode> {
  if (agent === undefined) {
    const active = records.filter((record) => record.archivedAtMs === undefined);
    return active.length === 0 ? err("agent.not_found") : ok(active);
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

function freezeEntry(
  options: FreezeAgentsOptions,
  agent: AgentRecord,
  stamp: { readonly atMs: number; readonly author: ConfigAuthor },
): LedgerDraft {
  const { atMs, author } = stamp;
  return {
    id: options.ids.next("led"),
    atMs,
    agentId: agent.id,
    kind: "freeze",
    subject: agent.id,
    data: { by: author.by, surface: author.surface },
  };
}

function frozenAtOf(targets: readonly AgentRecord[], marked: readonly AgentRecord[]): number {
  const times = targets.map(
    (target) =>
      marked.find((agent) => agent.id === target.id)?.frozenAtMs ?? target.frozenAtMs ?? 0,
  );
  return Math.max(...times);
}

/** One round: read the agents and their unsigned intents, then write the freeze, or `stale`. */
async function freezeOnce(
  options: FreezeAgentsOptions,
  request: FreezeRequest,
  signal: AbortSignal,
): Promise<Result<number, ProtocolErrorCode | "stale">> {
  const targets = targetsOf(await options.agents.list({ signal }), request.agent);
  if (!targets.ok) {
    return targets;
  }
  const { author } = request;
  const listed = await Promise.all(
    targets.value.map(async (agent) => unsignedOf(options.intents, agent.id, { signal })),
  );
  const moves = await cancelMoves(options, listed.flat(), { by: author.by, signal });
  const unfrozen = targets.value.filter((agent) => agent.frozenAtMs === undefined);
  if (unfrozen.length === 0 && moves.length === 0) {
    return ok(frozenAtOf(targets.value, []));
  }
  const atMs = options.clock.now();
  const agents = unfrozen.map((agent) => ({ agentId: agent.id, expectedVersion: agent.version }));
  const ledger = unfrozen.map((agent) => freezeEntry(options, agent, { atMs, author }));
  const commit = await options.stored.freeze({ atMs, agents, moves, ledger }, { signal });
  if (!commit.ok) {
    return commit;
  }
  for (const agent of unfrozen) {
    const values = { agent: agent.name, surface: author.surface };
    options.publish(noticePush({ key: frozenNoticeKey, agent: agent.id, values }));
  }
  return ok(frozenAtOf(targets.value, commit.value.agents));
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
 * Freezes one agent, or every agent not archived (ARCHITECTURE.md section 11), in one write: it
 * marks each agent frozen and cancels every intent of theirs that nothing has signed, a rescue
 * excepted (decision 0099); an intent being signed or sent runs to its end. Each newly frozen
 * agent is announced with `notice.frozen`. An agent frozen before keeps its time, and a freeze
 * that finds nothing to change writes nothing. It answers when the freeze took effect: the latest
 * time any of the agents was frozen. An unknown agent is `agent.not_found`, an archived one
 * `agent.archived`, and an install without an active agent `agent.not_found`. A write another
 * write beat is read and tried again.
 */
export async function freezeAgents(
  options: FreezeAgentsOptions,
  request: FreezeRequest,
  signal: AbortSignal,
): Promise<Result<number, ProtocolErrorCode>> {
  return freezeFrom(options, { request, round: 1 }, signal);
}
