import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { ChatDeletion, WriterFence } from "../ports.js";
import { fencedCheck, go, nthId, rejectsAborted } from "./agent-fixtures.js";
import { type ChatStores, plantAcrossCutoff } from "./agent-tables-plant.js";

/** Chat deletion on an empty agent database, with the stores that fill it and its fence. */
export interface ChatDeletionSubject extends ChatStores {
  readonly deletion: ChatDeletion;
  readonly fence: WriterFence;
}

/** Makes a fresh subject for each check. */
export interface ChatDeletionHarness {
  create(): Promise<ChatDeletionSubject>;
}

// What one agent's planting holds, as one deletion of it counts: its two chats and their two
// helpers' sessions, five turns, seven events, five queued messages, two goals, two progress notes
// and two helpers.
const plantedOfOne = {
  sessions: 4,
  turns: 5,
  events: 7,
  messages: 5,
  goals: 2,
  progressNotes: 2,
  helpers: 2,
};

// The `n`th id of a kind of agent `agent`, as the planting numbers them.
function plantedId<P extends string>(prefix: P, agent: number, n: number): Id<P> {
  return nthId(prefix, (agent - 1) * 1_000 + n);
}

// What the stores read of agent `agent`'s planted chats and notes.
async function readAgent(subject: ChatDeletionSubject, agent: number) {
  const agentId = nthId("agt", agent);
  const first = plantedId("ses", agent, 1);
  const chats = [first, plantedId("ses", agent, 12)];
  const helperSessions = [101, 112].map((n) => plantedId("ses", agent, n));
  const turns = [1, 2, 3, 4, 5].map((n) => plantedId("trn", agent, n));
  return {
    sessions: await Promise.all(
      [...chats, ...helperSessions].map(async (id) => subject.sessions.get(id, go())),
    ),
    turns: await Promise.all(turns.map(async (id) => subject.sessions.turn(id, go()))),
    events: await subject.transcript.events({ sessionId: first, limit: 50 }, go()),
    waiting: await subject.queue.waiting({ sessionId: first, limit: 50 }, go()),
    goals: await Promise.all(chats.map(async (id) => subject.goals.get(id, go()))),
    progress: await Promise.all(chats.map(async (id) => subject.goals.note(id, go()))),
    helpers: await subject.helpers.list({ agentId, limit: 50 }, go()),
    notes: await subject.notes.list({ agentId, limit: 50 }, go()),
  };
}

async function deletesOneAgent(subject: ChatDeletionSubject, fence: number): Promise<void> {
  await plantAcrossCutoff(subject, fence, 1);
  await plantAcrossCutoff(subject, fence, 2);
  const [one, other] = [await readAgent(subject, 1), await readAgent(subject, 2)];
  const agents = [nthId("agt", 1)];
  assert.deepEqual(await subject.deletion.delete({ agents, fence }, go()), {
    ok: true,
    value: plantedOfOne,
  });
  assert.deepEqual(await readAgent(subject, 1), {
    sessions: [undefined, undefined, undefined, undefined],
    turns: [undefined, undefined, undefined, undefined, undefined],
    events: [],
    waiting: [],
    goals: [undefined, undefined],
    progress: [undefined, undefined],
    helpers: [],
    notes: one.notes,
  });
  assert.deepEqual(await readAgent(subject, 2), other);
}

async function deletesEveryAgentNamed(subject: ChatDeletionSubject, fence: number) {
  await plantAcrossCutoff(subject, fence, 1);
  await plantAcrossCutoff(subject, fence, 2);
  const notes = [(await readAgent(subject, 1)).notes, (await readAgent(subject, 2)).notes];
  const agents = [nthId("agt", 1), nthId("agt", 2)];
  const both = Object.fromEntries(
    Object.entries(plantedOfOne).map(([kind, count]) => [kind, count * 2]),
  );
  assert.deepEqual(await subject.deletion.delete({ agents, fence }, go()), {
    ok: true,
    value: both,
  });
  const read = [await readAgent(subject, 1), await readAgent(subject, 2)];
  assert.deepEqual(
    read.map(({ events, waiting, helpers }) => [events, waiting, helpers]),
    [
      [[], [], []],
      [[], [], []],
    ],
  );
  assert.deepEqual(
    read.map((agent) => agent.notes),
    notes,
  );
}

async function refusesStaleFence(subject: ChatDeletionSubject, old: number): Promise<void> {
  await plantAcrossCutoff(subject, old, 1);
  const before = await readAgent(subject, 1);
  await subject.fence.raise(go());
  const agents = [nthId("agt", 1)];
  assert.deepEqual(await subject.deletion.delete({ agents, fence: old }, go()), {
    ok: false,
    error: "fenced",
  });
  assert.deepEqual(await readAgent(subject, 1), before);
}

async function refusesAborted(subject: ChatDeletionSubject, fence: number): Promise<void> {
  await plantAcrossCutoff(subject, fence, 1);
  const before = await readAgent(subject, 1);
  const deletion = { agents: [nthId("agt", 1)], fence };
  await rejectsAborted(async (options) => subject.deletion.delete(deletion, options));
  assert.deepEqual(await readAgent(subject, 1), before);
}

/** The contract every `ChatDeletion` adapter passes. */
export function chatDeletionContract(harness: ChatDeletionHarness): readonly ContractCheck[] {
  const create = async (): Promise<ChatDeletionSubject> => harness.create();
  return [
    fencedCheck(
      "deletes one agent's chats and leaves its notes and every other agent's chats",
      create,
      deletesOneAgent,
    ),
    fencedCheck("deletes the chats of every agent it names", create, deletesEveryAgentNamed),
    fencedCheck("refuses a deletion made with a fence raised since", create, refusesStaleFence),
    fencedCheck(
      "refuses a deletion on an aborted signal and deletes nothing",
      create,
      refusesAborted,
    ),
  ];
}
