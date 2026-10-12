import type { Id } from "@binference/core";
import type { QueuedMessage } from "@binference/store";
import { createChatTurn, type TurnReport } from "../loop/chat-turn.js";
import type { TurnStartAnswer } from "../relay/engine-chat-records.js";
import { createRelayTurnEngine } from "../relay/relay-turn-engine.js";
import { written } from "../sessions/agent-stores.js";
import { loadConversation } from "../sessions/conversation.js";
import { createSessionJournal } from "../sessions/session-journal.js";
import type { ChatContext } from "./chat-context.js";
import { messagesPerTurn, createQueueMerge } from "./queue-merge.js";
import { ownerMessageOf, type TurnMessage, turnMessageOf } from "./queued-view.js";

/** A waiting message with the view it holds. */
interface Waiting {
  readonly queued: QueuedMessage;
  readonly view: TurnMessage;
}

type Refused = Extract<TurnStartAnswer, { readonly started: false }>;

const retryMsDefault = 30_000;
const maxRunningDefault = 4;

function mayStart(context: ChatContext, agent: Id<"agt">): boolean {
  const { chats } = context;
  const resumesAt = chats.resumesAt.get(agent);
  return (
    !context.state.has("stopped") &&
    chats.sessions.has(agent) &&
    !chats.running.has(agent) &&
    (resumesAt === undefined || resumesAt <= context.clock.now()) &&
    chats.running.size < (context.maxRunning ?? maxRunningDefault)
  );
}

/** Drops waiting messages with a reason; one no longer waiting is left as it is. */
export async function dropMessages(
  context: ChatContext,
  messages: readonly Id<"msg">[],
  reason: string,
): Promise<void> {
  const { queue, fence } = context.stores;
  const signal = context.lifetime;
  for (const message of messages) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    const dropped = await queue.drop(
      { message, atMs: context.clock.now(), reason, fence },
      { signal },
    );
    if (!dropped.ok && dropped.error === "fenced") {
      written(dropped, "drop");
    }
  }
}

/** Closes a session a clear ended, at the version it holds now; one already closed stays so. */
export async function closeSession(context: ChatContext, session: Id<"ses">): Promise<void> {
  const { sessions, fence } = context.stores;
  const signal = context.lifetime;
  const stored = await sessions.get(session, { signal });
  if (stored !== undefined && stored.clearedAtMs === undefined) {
    const close = { session, atMs: context.clock.now(), version: stored.version, fence };
    written(await sessions.close(close, { signal }), "close a session");
  }
}

// Waits before the agent's next turn: until the time given, or until its next message.
function pause(context: ChatContext, agent: Id<"agt">, until: number): void {
  context.chats.resumesAt.set(agent, until);
  if (Number.isFinite(until)) {
    const wait = context.clock.sleep(Math.max(0, until - context.clock.now()), context.lifetime);
    void wait.then(
      () => kickAgent(context, agent),
      () => undefined,
    );
  }
}

// How a refused turn leaves its messages (decision 0174).
async function afterRefusal(context: ChatContext, agent: Id<"agt">, ended: TurnEnded) {
  const { refused, taken } = ended;
  const refusal = refused?.refusal ?? "unavailable";
  if (refusal === "budget") {
    pause(context, agent, refused?.resumesAt ?? Number.POSITIVE_INFINITY);
    return;
  }
  if (refusal === "unavailable") {
    pause(context, agent, context.clock.now() + (context.retryMs ?? retryMsDefault));
    return;
  }
  await dropMessages(
    context,
    taken.map(({ queued }) => queued.message),
    refusal,
  );
}

/** How a turn ended, the engine's refusal if it refused it, and the messages it took. */
interface TurnEnded {
  readonly report: TurnReport;
  readonly refused: Refused | undefined;
  readonly taken: readonly Waiting[];
}

async function afterTurn(context: ChatContext, agent: Id<"agt">, ended: TurnEnded): Promise<void> {
  const { chats } = context;
  chats.running.delete(agent);
  if (ended.report.state === "refused") {
    await afterRefusal(context, agent, ended);
  }
  const closing = chats.closing.get(agent);
  chats.closing.delete(agent);
  if (closing !== undefined) {
    await closeSession(context, closing);
  }
  if (chats.full.size > 0) {
    chats.full.clear();
    context.onRoom?.();
  }
  kickAll(context);
}

async function waitingOf(context: ChatContext, session: Id<"ses">): Promise<readonly Waiting[]> {
  const query = { sessionId: session, limit: messagesPerTurn };
  const waiting = await context.stores.queue.waiting(query, { signal: context.lifetime });
  return waiting.flatMap((queued) => {
    const view = turnMessageOf(queued);
    return view === undefined ? [] : [{ queued, view }];
  });
}

// Starts the agent's next turn when one may start and messages wait: it takes them, oldest first
// and at most 20, under the turn id the engine reserved for the first. The turn runs on its own.
async function startNext(context: ChatContext, agent: Id<"agt">): Promise<void> {
  const session = context.chats.sessions.get(agent);
  if (session === undefined || !mayStart(context, agent)) {
    return;
  }
  const taken = await waitingOf(context, session);
  const first = taken[0];
  if (first === undefined) {
    return;
  }
  const turn = first.view.turn;
  const used = await context.stores.sessions.turn(turn, { signal: context.lifetime });
  if (used?.endedAtMs !== undefined) {
    await dropMessages(
      context,
      taken.map(({ queued }) => queued.message),
      "turn_used",
    );
    return;
  }
  await runTurn(context, { agent, session, turn }, taken);
}

async function runTurn(
  context: ChatContext,
  place: { readonly agent: Id<"agt">; readonly session: Id<"ses">; readonly turn: Id<"trn"> },
  taken: readonly Waiting[],
): Promise<void> {
  const { stores, clock, lifetime } = context;
  const owners = taken.map(({ view }) => ownerMessageOf(view));
  const history = await loadConversation(stores.transcript, place.session, lifetime);
  const setup = context.setup(place.agent);
  const refusals: Refused[] = [];
  const engine = createRelayTurnEngine({
    chat: context.engine,
    stores,
    place,
    taken: owners,
    clock,
    onRefused: (refused) => refusals.push(refused),
  });
  const merge = createQueueMerge({
    stores,
    session: place.session,
    turn: place.turn,
    mode: context.mode,
    serial: context.serial,
  });
  const journal = createSessionJournal(stores, place, clock);
  const turn = createChatTurn({
    turnId: place.turn,
    parts: { transport: setup.transport, tools: setup.tools, journal, engine, merge, clock },
    instructions: setup.instructions,
    history: history.messages,
    taken: owners,
    outsideContent: history.outside,
    lifetime,
    ...(setup.limits === undefined ? {} : { limits: setup.limits }),
  });
  const done = turn
    .run()
    .then(async (report) =>
      context.serial(async () =>
        afterTurn(context, place.agent, { report, refused: refusals[0], taken }),
      ),
    );
  context.chats.running.set(place.agent, { turn, done });
  context.track(done);
}

/** Asks the agent's chat to start its next turn, after the chat queue's earlier work. */
export function kickAgent(context: ChatContext, agent: Id<"agt">): void {
  context.track(context.serial(async () => startNext(context, agent)));
}

/** Asks every agent's chat to start its next turn: a turn ended, or the runtime started. */
export function kickAll(context: ChatContext): void {
  for (const agent of context.chats.sessions.keys()) {
    kickAgent(context, agent);
  }
}
