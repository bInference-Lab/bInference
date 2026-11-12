import type { Id } from "@binference/core";
import type { EventDraft } from "../chats/transcript-event.js";
import { go, nthId, nthSession, okValue } from "./agent-fixtures.js";
import type { AgentTablesSubject } from "./agent-tables-contract.js";

// Rows in every agent table on both sides of a cutoff at 10 seconds, written through the stores,
// for the case that checks what retention removes and what it leaves.

/** The time retention's run removes the chats before. */
export const plantCutoff = 10_000;

const agentId = nthId("agt", 1);
const model = "openai/gpt-5";

interface PlantedTurn {
  readonly n: number;
  readonly session: Id<"ses">;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly saidAtMs: readonly number[];
}

// Turn n of a session, with the events it said, ended once they are written.
async function plantTurn(subject: AgentTablesSubject, fence: number, turn: PlantedTurn) {
  const id = nthId("trn", turn.n);
  const draft = { id, sessionId: turn.session, startedAtMs: turn.startedAtMs, model };
  okValue(await subject.sessions.startTurn({ ...draft, outsideContent: false, fence }, go()));
  const events = turn.saidAtMs.map((atMs): EventDraft => ({
    turnId: id,
    role: "agent",
    kind: "text",
    content: { text: `said at ${String(atMs)}` },
    outside: false,
    atMs,
  }));
  if (events.length > 0) {
    okValue(await subject.transcript.append({ sessionId: turn.session, events, fence }, go()));
  }
  if (turn.endedAtMs !== undefined) {
    const end = { turn: id, atMs: turn.endedAtMs, outcome: "ok", heldBack: 0 } as const;
    okValue(await subject.sessions.endTurn({ ...end, fence }, go()));
  }
}

// Turns that ended before the cutoff with every event before it (1), with an event after it (2),
// one that never ended (3), one that said nothing (4), and one after the cutoff (5); and two events
// of no turn, one on each side.
async function plantTranscript(subject: AgentTablesSubject, fence: number): Promise<void> {
  const session = nthId("ses", 1);
  const turns: readonly Omit<PlantedTurn, "session">[] = [
    { n: 1, startedAtMs: 1_000, endedAtMs: 2_000, saidAtMs: [1_500] },
    { n: 2, startedAtMs: 3_000, endedAtMs: 4_000, saidAtMs: [3_500, 12_000] },
    { n: 3, startedAtMs: 5_000, saidAtMs: [5_500] },
    { n: 4, startedAtMs: 6_000, endedAtMs: 7_000, saidAtMs: [] },
    { n: 5, startedAtMs: 11_000, endedAtMs: 13_000, saidAtMs: [11_500] },
  ];
  await turns.reduce<Promise<void>>(async (earlier, turn) => {
    await earlier;
    await plantTurn(subject, fence, { ...turn, session });
  }, Promise.resolve());
  const loose = [500, 15_000].map((atMs): EventDraft => ({
    role: "system",
    kind: "summary",
    content: { atMs },
    outside: false,
    atMs,
  }));
  okValue(await subject.transcript.append({ sessionId: session, events: loose, fence }, go()));
}

// Messages received before the cutoff that a turn took (1), that were dropped (2) and that wait
// (3), and after it, taken (4) and dropped (5).
async function plantQueue(subject: AgentTablesSubject, fence: number): Promise<void> {
  const received = [1_000, 2_000, 3_000, 12_000, 12_500];
  await received.reduce<Promise<void>>(async (earlier, receivedAtMs, index) => {
    await earlier;
    const draft = {
      message: nthId("msg", index + 1),
      agentId,
      sessionId: nthId("ses", 1),
      kind: "inbox/message",
      payload: { text: "hi" },
      receivedAtMs,
    } as const;
    okValue(await subject.queue.add({ ...draft, fence }, go()));
  }, Promise.resolve());
  const { queue } = subject;
  const take = async (message: number, turn: number) =>
    queue.take({ messages: [nthId("msg", message)], turn: nthId("trn", turn), fence }, go());
  const drop = async (message: number, atMs: number) =>
    queue.drop({ message: nthId("msg", message), atMs, reason: "budget", fence }, go());
  okValue(await take(1, 1));
  okValue(await drop(2, 2_500));
  okValue(await take(4, 5));
  okValue(await drop(5, 12_600));
}

// A chat started before the cutoff and one after it, each with its own model, a goal and a
// progress note, and a helper; and a note on each side, the old one removed.
async function plantSessionRows(subject: AgentTablesSubject, fence: number, n: number) {
  const session = nthSession(n);
  okValue(await subject.sessions.open({ ...session, fence }, go()));
  okValue(await subject.sessions.setModel({ session: session.id, model, fence }, go()));
  const at = session.startedAtMs;
  const goal = { sessionId: session.id, agentId, objective: "Watch the market", startedAtMs: at };
  okValue(await subject.goals.set({ ...goal, fence }, go()));
  const plan = [{ text: "Read the chart", state: "doing" }] as const;
  const note = { sessionId: session.id, agentId, markdown: "Reading", plan, updatedAtMs: at };
  okValue(await subject.goals.putNote({ ...note, fence }, go()));
  const helper = {
    id: nthId("ses", 100 + n),
    agentId,
    parentSessionId: session.id,
    label: "scout",
    startedAtMs: at + 100,
    timeoutMs: 600_000,
    model,
  };
  okValue(await subject.helpers.start({ ...helper, fence }, go()));
  const end = { helper: helper.id, from: "running", to: "done", atMs: at + 200 } as const;
  okValue(await subject.helpers.move({ ...end, outside: true, fence }, go()));
  const written = okValue(
    await subject.notes.write(
      { agentId, text: "Likes stablecoins", origin: "owner", atMs: at, fence },
      go(),
    ),
  );
  return written.id;
}

/** Fills every agent table with rows on both sides of {@link plantCutoff}. */
export async function plantAcrossCutoff(subject: AgentTablesSubject, fence: number): Promise<void> {
  const oldNote = await plantSessionRows(subject, fence, 1);
  await plantSessionRows(subject, fence, 12);
  okValue(await subject.notes.delete({ note: oldNote, atMs: 2_000, fence }, go()));
  await plantTranscript(subject, fence);
  await plantQueue(subject, fence);
}
