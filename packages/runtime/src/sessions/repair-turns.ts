import type { Clock, Id } from "@binference/core";
import type { EventDraft, TranscriptEvent, TurnRecord } from "@binference/store";
import { type AgentStores, written } from "./agent-stores.js";
import { notRunAfterRestart } from "./conversation.js";
import { toolCallContentSchema, toolResultContentSchema } from "./event-content.schema.js";

/** The result of a proposal whose engine answer was never stored (runtime spec, section 2.4). */
export const proposalUnknownAfterRestart =
  "the outcome of this proposal is unknown after a restart; it was not sent again";

/** A turn a crash left unfinished, which the start repaired and ended `failed`. */
export interface RepairedTurn {
  readonly agent: Id<"agt">;
  readonly session: Id<"ses">;
  readonly turn: Id<"trn">;
  /** It holds a proposal whose outcome is unknown. */
  readonly proposalUnknown: boolean;
}

/** A call of the turn that has no result in the transcript. */
interface OpenCall {
  readonly callId: string;
  readonly name: string;
  readonly proposal: boolean;
}

const pageSize = 1_000;

async function turnEvents(
  stores: AgentStores,
  turn: TurnRecord,
  signal: AbortSignal,
): Promise<readonly TranscriptEvent[]> {
  const events: TranscriptEvent[] = [];
  for (let afterSeq = 0; ;) {
    const query = { sessionId: turn.sessionId, afterSeq, limit: pageSize };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the one before
    const page = await stores.transcript.events(query, { signal });
    events.push(...page.filter((event) => event.turnId === turn.id));
    afterSeq = page.at(-1)?.seq ?? afterSeq;
    if (page.length < pageSize) {
      return events;
    }
  }
}

/** The calls of a turn's events with no result, in the order they were written. */
export function openCallsOf(events: readonly TranscriptEvent[]): readonly OpenCall[] {
  const answered = new Set(
    events.flatMap((event) => {
      const result =
        event.kind === "tool_result" && toolResultContentSchema.safeParse(event.content);
      return result !== false && result.success ? [result.data.callId] : [];
    }),
  );
  return events.flatMap((event) => {
    const call = event.kind === "tool_call" && toolCallContentSchema.safeParse(event.content);
    if (call === false || !call.success || answered.has(call.data.callId)) {
      return [];
    }
    const { callId, name } = call.data;
    return [{ callId, name, proposal: call.data.proposal === true }];
  });
}

function resultEvent(call: OpenCall, turn: Id<"trn">, atMs: number): EventDraft {
  const text = call.proposal ? proposalUnknownAfterRestart : notRunAfterRestart;
  const content = { callId: call.callId, name: call.name, text, isError: true, ran: call.proposal };
  return { turnId: turn, role: "tool", kind: "tool_result", content, outside: false, atMs };
}

async function repairTurn(
  stores: AgentStores,
  turn: TurnRecord,
  context: { readonly clock: Clock; readonly signal: AbortSignal },
): Promise<RepairedTurn | undefined> {
  const { signal, clock } = context;
  const open = openCallsOf(await turnEvents(stores, turn, signal));
  const { fence } = stores;
  if (open.length > 0) {
    const events = open.map((call) => resultEvent(call, turn.id, clock.now()));
    const append = { sessionId: turn.sessionId, events, fence };
    written(await stores.transcript.append(append, { signal }), "repair");
  }
  const end = {
    turn: turn.id,
    atMs: clock.now(),
    outcome: "failed" as const,
    heldBack: turn.heldBack,
  };
  written(await stores.sessions.endTurn({ ...end, fence }, { signal }), "end a repaired turn");
  const session = await stores.sessions.get(turn.sessionId, { signal });
  if (session === undefined) {
    return undefined;
  }
  const proposalUnknown = open.some((call) => call.proposal);
  return { agent: session.agentId, session: session.id, turn: turn.id, proposalUnknown };
}

/**
 * Repairs every turn a crash left unfinished, before the runtime connects (runtime spec, section
 * 2.4): each call without a result gets one, a proposal "outcome unknown" and any other "not run",
 * and the turn ends `failed`. Nothing is proposed again. Answers the turns it repaired, whose
 * `turn/end` goes to the engine once the runtime is connected.
 */
export async function repairUnfinishedTurns(
  stores: AgentStores,
  context: { readonly clock: Clock; readonly signal: AbortSignal },
): Promise<readonly RepairedTurn[]> {
  const repaired: RepairedTurn[] = [];
  for (const turn of await stores.sessions.unfinishedTurns({ signal: context.signal })) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, oldest turn first
    const done = await repairTurn(stores, turn, context);
    if (done !== undefined) {
      repaired.push(done);
    }
  }
  return repaired;
}
