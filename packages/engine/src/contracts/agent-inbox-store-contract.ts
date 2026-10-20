import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import {
  type AgentInboxDraft,
  maxUntakenMessages,
  settleIdsOf,
} from "../chat/agent-inbox-record.js";
import type { AgentInboxStore } from "../chat/ports.js";
import { type IntentStoreSubject, intentDraft, intentMove } from "./intent-fixtures.js";
import { assertRefusesAborted, checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

/**
 * An agent inbox under test, and the intent store of the same database, which writes settle
 * messages into it, with an agent and its wallet that exist there.
 */
export interface AgentInboxSubject extends IntentStoreSubject {
  readonly agentInbox: AgentInboxStore;
}

/** Makes a fresh subject for each check. */
export interface AgentInboxStoreHarness {
  create(): Promise<AgentInboxSubject>;
}

const firstSession = fixtureId("ses", 1);
const nextSession = fixtureId("ses", 2);

function message(subject: AgentInboxSubject, n: number, atMs = 1_000 + n): AgentInboxDraft {
  return {
    id: fixtureId("msg", n),
    agentId: subject.agentId,
    kind: "inbox/message",
    turnId: fixtureId("trn", n),
    payload: { text: `message ${String(n)}`, surface: "telegram" },
    atMs,
    opens: firstSession,
  };
}

async function added(subject: AgentInboxSubject, draft: AgentInboxDraft) {
  const result = await subject.agentInbox.add(draft, live());
  assert.ok(result.ok, `the message ${draft.id} is stored`);
  return result.value;
}

async function opensAndClears(subject: AgentInboxSubject): Promise<void> {
  const { agentInbox, agentId } = subject;
  assert.equal(await agentInbox.openSession(agentId, live()), undefined);
  const first = await added(subject, message(subject, 1));
  assert.deepEqual(first, {
    id: fixtureId("msg", 1),
    agentId,
    sessionId: firstSession,
    kind: "inbox/message",
    turnId: fixtureId("trn", 1),
    payload: { text: "message 1", surface: "telegram" },
    createdAtMs: 1_001,
  });
  const second = await added(subject, { ...message(subject, 2), opens: nextSession });
  assert.equal(second.sessionId, firstSession);
  const clear = await added(subject, {
    id: fixtureId("msg", 3),
    agentId,
    kind: "inbox/clear",
    payload: { next: nextSession },
    atMs: 1_003,
    opens: nextSession,
    next: nextSession,
  });
  assert.equal(clear.sessionId, firstSession);
  assert.equal(clear.turnId, undefined);
  assert.equal(await agentInbox.openSession(agentId, live()), nextSession);
  assert.equal((await added(subject, message(subject, 4))).sessionId, nextSession);
}

async function listsAndTakes(subject: AgentInboxSubject): Promise<void> {
  const { agentInbox, agentId } = subject;
  // Two messages at one time list by id; the later time comes after both.
  await added(subject, message(subject, 3, 1_000));
  await added(subject, message(subject, 1, 2_000));
  await added(subject, message(subject, 2, 1_000));
  const ids = async (after?: { readonly createdAtMs: number; readonly id: Id<"msg"> }) =>
    (
      await agentInbox.untaken(
        { agentId, limit: 10, ...(after === undefined ? {} : { after }) },
        live(),
      )
    ).map((stored) => stored.id);
  assert.deepEqual(await ids(), [fixtureId("msg", 2), fixtureId("msg", 3), fixtureId("msg", 1)]);
  assert.deepEqual(await ids({ createdAtMs: 1_000, id: fixtureId("msg", 2) }), [
    fixtureId("msg", 3),
    fixtureId("msg", 1),
  ]);
  const taken = { ids: [fixtureId("msg", 3), fixtureId("msg", 9)], atMs: 3_000 };
  assert.equal(await agentInbox.take(taken, live()), 1);
  assert.equal((await agentInbox.get(fixtureId("msg", 3), live()))?.takenAtMs, 3_000);
  assert.equal((await agentInbox.get(fixtureId("msg", 2), live()))?.createdAtMs, 1_000);
  assert.equal(await agentInbox.get(fixtureId("msg", 9), live()), undefined);
  assert.equal(await agentInbox.take({ ...taken, atMs: 4_000 }, live()), 0);
  assert.deepEqual(await ids(), [fixtureId("msg", 2), fixtureId("msg", 1)]);
  assert.deepEqual(
    (await agentInbox.untaken({ limit: 1 }, live())).map((stored) => stored.id),
    [fixtureId("msg", 2)],
  );
  const other = await agentInbox.untaken({ agentId: fixtureId("agt", 99), limit: 10 }, live());
  assert.deepEqual(other, []);
}

async function refusesPastTheCap(subject: AgentInboxSubject): Promise<void> {
  const { agentInbox, agentId } = subject;
  const numbers = Array.from({ length: maxUntakenMessages }, (_, index) => index + 1);
  await inOrder(numbers, async (n) => added(subject, message(subject, n)));
  const over = await agentInbox.add(message(subject, 500), live());
  assert.deepEqual(over, { ok: false, error: "busy" });
  const report = await agentInbox.add(
    { ...message(subject, 503), kind: "inbox/resumeReport", payload: { checked: 0 } },
    live(),
  );
  assert.deepEqual(report, { ok: false, error: "busy" });
  const stop = await agentInbox.add(
    {
      id: fixtureId("msg", 501),
      agentId,
      kind: "inbox/stop",
      payload: { reason: "owner" },
      atMs: 9_000,
      opens: firstSession,
    },
    live(),
  );
  assert.ok(stop.ok);
  await agentInbox.take({ ids: [fixtureId("msg", 1), fixtureId("msg", 501)], atMs: 9_001 }, live());
  assert.ok((await agentInbox.add(message(subject, 502), live())).ok);
}

async function refusesUnknownAgentsAndIds(subject: AgentInboxSubject): Promise<void> {
  const { agentInbox } = subject;
  const stranger = { ...message(subject, 1), agentId: fixtureId("agt", 99) };
  assert.deepEqual(await agentInbox.add(stranger, live()), { ok: false, error: "not_found" });
  await added(subject, message(subject, 1));
  await assert.rejects(agentInbox.add({ ...message(subject, 1), atMs: 5_000 }, live()), {
    code: "store.constraint",
  });
  assert.equal((await agentInbox.untaken({ limit: 10 }, live())).length, 1);
}

// The runtime's intents carry its role in their first event; the store reads it from there.
async function proposeAs(subject: AgentInboxSubject, n: number, proposer: string) {
  const draft = intentDraft(subject, n);
  const created = await subject.store.create(
    { ...draft, cause: { trigger: "propose", proposer } },
    live(),
  );
  assert.ok(created.ok);
  assert.equal(created.value.settled, undefined);
}

async function settlesRuntimeIntents(subject: AgentInboxSubject): Promise<void> {
  const { store, agentInbox, agentId } = subject;
  await proposeAs(subject, 1, "agent_runtime");
  await proposeAs(subject, 2, "owner");
  const checked = await store.transition(intentMove(1, 0, "checked"), live());
  assert.ok(checked.ok);
  assert.equal(checked.value.settled, undefined);
  const ended = await store.transition(intentMove(1, 1, "rejected_policy"), live());
  assert.ok(ended.ok);
  const ids = settleIdsOf(fixtureId("int", 1));
  const settled = {
    id: ids.message,
    agentId,
    sessionId: ids.session,
    kind: "inbox/intentSettled",
    turnId: ids.turn,
    payload: { intent: fixtureId("int", 1) },
    createdAtMs: ended.value.intent.changedAtMs,
  };
  assert.deepEqual(ended.value.settled, settled);
  const owner = await store.transition(intentMove(2, 0, "cancelled"), live());
  assert.ok(owner.ok);
  assert.equal(owner.value.settled, undefined);
  assert.deepEqual(await agentInbox.untaken({ agentId, limit: 10 }, live()), [settled]);
  assert.equal(await agentInbox.openSession(agentId, live()), ids.session);
}

async function settlesInTheOpenSession(subject: AgentInboxSubject): Promise<void> {
  const { store, agentInbox, agentId } = subject;
  await added(subject, message(subject, 1));
  await proposeAs(subject, 3, "agent_runtime");
  const ended = await store.transition(intentMove(3, 0, "denied"), live());
  assert.ok(ended.ok);
  assert.equal(ended.value.settled?.sessionId, firstSession);
  assert.equal(await agentInbox.openSession(agentId, live()), firstSession);
}

async function refusesAborted(subject: AgentInboxSubject): Promise<void> {
  const { agentInbox, agentId } = subject;
  await assertRefusesAborted(async (options) => agentInbox.add(message(subject, 1), options));
  await assertRefusesAborted(async (options) => agentInbox.openSession(agentId, options));
  await assertRefusesAborted(async (options) => agentInbox.get(fixtureId("msg", 1), options));
  await assertRefusesAborted(async (options) => agentInbox.untaken({ limit: 1 }, options));
  await assertRefusesAborted(async (options) =>
    agentInbox.take({ ids: [fixtureId("msg", 1)], atMs: 1 }, options),
  );
  assert.deepEqual(await agentInbox.untaken({ limit: 10 }, live()), []);
}

/** The contract every `AgentInboxStore` adapter passes, with its database's intent store. */
export function agentInboxStoreContract(harness: AgentInboxStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<AgentInboxSubject> => harness.create();
  return [
    checkOn("opens a session at the first message and moves it at a clear", create, opensAndClears),
    checkOn(
      "lists untaken messages oldest first, takes each once and gets one by id",
      create,
      listsAndTakes,
    ),
    checkOn("refuses an owner's message past 200 untaken, never a stop", create, refusesPastTheCap),
    checkOn("refuses an unknown agent and a message id in use", create, refusesUnknownAgentsAndIds),
    checkOn(
      "writes a settle message with the end of a runtime intent",
      create,
      settlesRuntimeIntents,
    ),
    checkOn("settles into the agent's open session", create, settlesInTheOpenSession),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
