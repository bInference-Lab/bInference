import type { Id } from "@binference/core";
import type { EventDraft } from "../chats/transcript-event.js";
import type {
  ChatQueueStore,
  GoalStore,
  HelperStore,
  NoteStore,
  SessionStore,
  TranscriptStore,
} from "../ports.js";
import { go, nthId, nthSession, okValue } from "./agent-fixtures.js";

// Rows in every agent table on both sides of a cutoff at 10 seconds, written through the stores,
// for the cases that check what retention and a deletion remove and what they leave.

/** The time retention's run removes the chats before. */
export const plantCutoff = 10_000;

/** The stores that write an agent's chats and notes. */
export interface ChatStores {
  readonly sessions: SessionStore;
  readonly transcript: TranscriptStore;
  readonly queue: ChatQueueStore;
  readonly helpers: HelperStore;
  readonly goals: GoalStore;
  readonly notes: NoteStore;
}

const model = "openai/gpt-5";

/** One agent's planting: agent `n`'s rows take ids from `(n - 1) * 1000 + 1` on. */
interface Planting {
  readonly stores: ChatStores;
  readonly fence: number;
  readonly agent: number;
}

function agentOf(planting: Planting): Id<"agt"> {
  return nthId("agt", planting.agent);
}

// The `n`th id of a kind for the planting's agent.
function idOf<P extends string>(planting: Planting, prefix: P, n: number): Id<P> {
  return nthId(prefix, (planting.agent - 1) * 1_000 + n);
}

interface PlantedTurn {
  readonly n: number;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly saidAtMs: readonly number[];
}

// Turn n of the agent's first chat, with the events it said, ended once they are written.
async function plantTurn(planting: Planting, turn: PlantedTurn) {
  const { stores, fence } = planting;
  const id = idOf(planting, "trn", turn.n);
  const sessionId = idOf(planting, "ses", 1);
  const draft = { id, sessionId, startedAtMs: turn.startedAtMs, model, outsideContent: false };
  okValue(await stores.sessions.startTurn({ ...draft, fence }, go()));
  const events = turn.saidAtMs.map((atMs): EventDraft => ({
    turnId: id,
    role: "agent",
    kind: "text",
    content: { text: `said at ${String(atMs)}` },
    outside: false,
    atMs,
  }));
  if (events.length > 0) {
    okValue(await stores.transcript.append({ sessionId, events, fence }, go()));
  }
  if (turn.endedAtMs !== undefined) {
    const end = { turn: id, atMs: turn.endedAtMs, outcome: "ok", heldBack: 0 } as const;
    okValue(await stores.sessions.endTurn({ ...end, fence }, go()));
  }
}

// Turns that ended before the cutoff with every event before it (1), with an event after it (2),
// one that never ended (3), one that said nothing (4), and one after the cutoff (5); and two events
// of no turn, one on each side.
async function plantTranscript(planting: Planting): Promise<void> {
  const turns: readonly PlantedTurn[] = [
    { n: 1, startedAtMs: 1_000, endedAtMs: 2_000, saidAtMs: [1_500] },
    { n: 2, startedAtMs: 3_000, endedAtMs: 4_000, saidAtMs: [3_500, 12_000] },
    { n: 3, startedAtMs: 5_000, saidAtMs: [5_500] },
    { n: 4, startedAtMs: 6_000, endedAtMs: 7_000, saidAtMs: [] },
    { n: 5, startedAtMs: 11_000, endedAtMs: 13_000, saidAtMs: [11_500] },
  ];
  await turns.reduce<Promise<void>>(async (earlier, turn) => {
    await earlier;
    await plantTurn(planting, turn);
  }, Promise.resolve());
  const loose = [500, 15_000].map((atMs): EventDraft => ({
    role: "system",
    kind: "summary",
    content: { atMs },
    outside: false,
    atMs,
  }));
  const sessionId = idOf(planting, "ses", 1);
  const { transcript } = planting.stores;
  okValue(await transcript.append({ sessionId, events: loose, fence: planting.fence }, go()));
}

// Messages received before the cutoff that a turn took (1), that were dropped (2) and that wait
// (3), and after it, taken (4) and dropped (5).
async function plantQueue(planting: Planting): Promise<void> {
  const { fence } = planting;
  const { queue } = planting.stores;
  const received = [1_000, 2_000, 3_000, 12_000, 12_500];
  await received.reduce<Promise<void>>(async (earlier, receivedAtMs, index) => {
    await earlier;
    const draft = {
      message: idOf(planting, "msg", index + 1),
      agentId: agentOf(planting),
      sessionId: idOf(planting, "ses", 1),
      kind: "inbox/message",
      payload: { text: "hi" },
      receivedAtMs,
    } as const;
    okValue(await queue.add({ ...draft, fence }, go()));
  }, Promise.resolve());
  const take = async (message: number, turn: number) =>
    queue.take(
      { messages: [idOf(planting, "msg", message)], turn: idOf(planting, "trn", turn), fence },
      go(),
    );
  const drop = async (message: number, atMs: number) =>
    queue.drop({ message: idOf(planting, "msg", message), atMs, reason: "budget", fence }, go());
  okValue(await take(1, 1));
  okValue(await drop(2, 2_500));
  okValue(await take(4, 5));
  okValue(await drop(5, 12_600));
}

// A chat started at `n` seconds with its own model, a goal and a progress note, a helper, and a
// note of the agent's.
async function plantSessionRows(planting: Planting, n: number) {
  const { stores, fence } = planting;
  const agentId = agentOf(planting);
  const session = { ...nthSession(n), id: idOf(planting, "ses", n), agentId };
  okValue(await stores.sessions.open({ ...session, fence }, go()));
  okValue(await stores.sessions.setModel({ session: session.id, model, fence }, go()));
  const at = session.startedAtMs;
  const goal = { sessionId: session.id, agentId, objective: "Watch the market", startedAtMs: at };
  okValue(await stores.goals.set({ ...goal, fence }, go()));
  const plan = [{ text: "Read the chart", state: "doing" }] as const;
  const note = { sessionId: session.id, agentId, markdown: "Reading", plan, updatedAtMs: at };
  okValue(await stores.goals.putNote({ ...note, fence }, go()));
  const helper = {
    id: idOf(planting, "ses", 100 + n),
    agentId,
    parentSessionId: session.id,
    label: "scout",
    startedAtMs: at + 100,
    timeoutMs: 600_000,
    model,
  };
  okValue(await stores.helpers.start({ ...helper, fence }, go()));
  const end = { helper: helper.id, from: "running", to: "done", atMs: at + 200 } as const;
  okValue(await stores.helpers.move({ ...end, outside: true, fence }, go()));
  const kept = { agentId, text: "Likes stablecoins", origin: "owner", atMs: at } as const;
  return okValue(await stores.notes.write({ ...kept, fence }, go())).id;
}

/**
 * Fills every agent table with rows of agent `agent`, 1 unless named, on both sides of
 * {@link plantCutoff}: chats started at 1 and 12 seconds, each with its own model, goal, progress
 * note, helper and a note, the older note removed; five turns and seven events in the first chat;
 * five queued messages, taken, dropped and waiting.
 */
export async function plantAcrossCutoff(
  stores: ChatStores,
  fence: number,
  agent = 1,
): Promise<void> {
  const planting = { stores, fence, agent };
  const oldNote = await plantSessionRows(planting, 1);
  await plantSessionRows(planting, 12);
  okValue(await stores.notes.delete({ note: oldNote, atMs: 2_000, fence }, go()));
  await plantTranscript(planting);
  await plantQueue(planting);
}
