import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { AgentInboxStore } from "../chat/ports.js";
import type { ScheduleStore } from "../schedules/ports.js";
import {
  maxActiveSchedules,
  type ScheduleRecord,
  type ScheduleRunDraft,
} from "../schedules/schedule-record.js";
import { fillAgentInbox } from "./inbox-fixtures.js";
import { assertRefusesAborted, checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

/** A schedule store under test, the agent inbox of the same database, and an agent there. */
export interface ScheduleSubject {
  readonly schedules: ScheduleStore;
  readonly agentInbox: AgentInboxStore;
  readonly agentId: Id<"agt">;
}

/** Makes a fresh subject for each check. */
export interface ScheduleStoreHarness {
  create(): Promise<ScheduleSubject>;
}

const session = fixtureId("ses", 1);
const hourMs = 3_600_000;

function schedule(subject: ScheduleSubject, n: number): ScheduleRecord {
  return {
    id: fixtureId("sch", n),
    agentId: subject.agentId,
    when: { cron: "0 * * * *" },
    prompt: `review ${String(n)}`,
    state: "active",
    nextAtMs: n * hourMs,
    zone: "Asia/Shanghai",
    createdBy: "telegram",
    outsideContent: false,
    createdAtMs: n,
    changedAtMs: n,
  };
}

function runOf(
  n: number,
  dueAtMs: number,
  extra: Partial<ScheduleRunDraft> = {},
): ScheduleRunDraft {
  return {
    id: fixtureId("sch", n),
    dueAtMs,
    atMs: dueAtMs + 5,
    wake: {
      id: fixtureId("msg", dueAtMs / hourMs),
      turnId: fixtureId("trn", dueAtMs / hourMs),
      opens: session,
      payload: { schedule: fixtureId("sch", n), prompt: "review", due: dueAtMs },
    },
    next: { nextAtMs: dueAtMs + hourMs, zone: "Asia/Shanghai" },
    ...extra,
  };
}

async function created(subject: ScheduleSubject, record: ScheduleRecord) {
  return subject.schedules.create(record, live());
}

async function storesAndLists(subject: ScheduleSubject): Promise<void> {
  const { schedules, agentId } = subject;
  const [first, second] = [schedule(subject, 2), schedule(subject, 1)];
  assert.deepEqual(await created(subject, first), { ok: true, value: first });
  await created(subject, second);
  assert.deepEqual(await schedules.get(first.id, live()), first);
  assert.deepEqual(await schedules.active({ agentId }, live()), [second, first]);
  assert.deepEqual(await schedules.active({}, live()), [second, first]);
  assert.deepEqual(await schedules.due({ atMs: hourMs, limit: 10 }, live()), [second]);
  assert.deepEqual(await schedules.due({ atMs: 2 * hourMs, limit: 1 }, live()), [second]);
  const stranger = { ...schedule(subject, 3), agentId: fixtureId("agt", 99) };
  assert.deepEqual(await created(subject, stranger), { ok: false, error: "not_found" });
  assert.equal(await schedules.get(fixtureId("sch", 9), live()), undefined);
}

async function holdsFiftyActive(subject: ScheduleSubject): Promise<void> {
  const numbers = Array.from({ length: maxActiveSchedules }, (_, index) => index + 1);
  await inOrder(numbers, async (n) => created(subject, schedule(subject, n)));
  const more = schedule(subject, maxActiveSchedules + 1);
  assert.deepEqual(await created(subject, more), { ok: false, error: "too_many" });
  await subject.schedules.cancel({ id: fixtureId("sch", 1), atMs: 9 }, live());
  assert.equal((await created(subject, more)).ok, true);
}

async function cancelsOnce(subject: ScheduleSubject): Promise<void> {
  const { schedules } = subject;
  const record = schedule(subject, 1);
  await created(subject, record);
  const { nextAtMs: _next, ...rest } = record;
  const cancelled = { ...rest, state: "cancelled", changedAtMs: 50 };
  assert.deepEqual(await schedules.cancel({ id: record.id, atMs: 50 }, live()), cancelled);
  assert.equal(await schedules.cancel({ id: record.id, atMs: 60 }, live()), undefined);
  assert.equal(await schedules.cancel({ id: fixtureId("sch", 9), atMs: 60 }, live()), undefined);
  assert.deepEqual(await schedules.active({}, live()), []);
  assert.deepEqual(await schedules.due({ atMs: 10 * hourMs, limit: 10 }, live()), []);
}

async function runsAndWakesOnce(subject: ScheduleSubject): Promise<void> {
  const { schedules, agentInbox, agentId } = subject;
  await created(subject, schedule(subject, 1));
  const sent = await schedules.run(runOf(1, hourMs), live());
  assert.ok(sent.ok);
  const { message } = sent.value;
  assert.equal(message?.kind, "inbox/scheduleDue");
  assert.deepEqual(sent.value.schedule.lastRun, { due: hourMs, at: hourMs + 5, outcome: "sent" });
  assert.equal(sent.value.schedule.nextAtMs, 2 * hourMs);
  assert.equal(sent.value.schedule.lastMessageId, message?.id);
  const untaken = await agentInbox.untaken({ agentId, limit: 10 }, live());
  assert.deepEqual(untaken, [message]);
  // The wake-up still waits, so the next run adds none.
  const waiting = await schedules.run(runOf(1, 2 * hourMs), live());
  assert.deepEqual(waiting.ok && [waiting.value.message, waiting.value.schedule.lastRun?.reason], [
    undefined,
    "waiting",
  ]);
  await agentInbox.take({ ids: untaken.map(({ id }) => id), atMs: 3 * hourMs }, live());
  const again = await schedules.run(runOf(1, 3 * hourMs), live());
  assert.equal(again.ok && again.value.schedule.lastRun?.outcome, "sent");
}

async function skipsAndEnds(subject: ScheduleSubject): Promise<void> {
  const { schedules, agentInbox, agentId } = subject;
  await created(subject, schedule(subject, 1));
  const skipped = await schedules.run(runOf(1, hourMs, { skip: "budget" }), live());
  assert.deepEqual(skipped.ok && skipped.value.schedule.lastRun, {
    due: hourMs,
    at: hourMs + 5,
    outcome: "skipped",
    reason: "budget",
  });
  assert.deepEqual(await agentInbox.untaken({ agentId, limit: 10 }, live()), []);
  const { next: _next, ...last } = runOf(1, 2 * hourMs);
  const ended = await schedules.run(last, live());
  assert.ok(ended.ok);
  assert.equal(ended.value.schedule.state, "ended");
  assert.equal(ended.value.schedule.nextAtMs, undefined);
  assert.deepEqual(await schedules.active({}, live()), []);
}

async function refusesStaleRuns(subject: ScheduleSubject): Promise<void> {
  const { schedules } = subject;
  await created(subject, schedule(subject, 1));
  const stale = { ok: false, error: "stale" };
  assert.deepEqual(await schedules.run(runOf(1, 2 * hourMs), live()), stale);
  assert.deepEqual(await schedules.run(runOf(2, hourMs), live()), stale);
  await schedules.cancel({ id: fixtureId("sch", 1), atMs: 7 }, live());
  assert.deepEqual(await schedules.run(runOf(1, hourMs), live()), stale);
}

async function rezonesWhileExpected(subject: ScheduleSubject): Promise<void> {
  const { schedules } = subject;
  const record = schedule(subject, 1);
  await created(subject, record);
  const move = { id: record.id, expectedNextAtMs: hourMs, nextAtMs: 5 * hourMs, atMs: 70 };
  const moved = await schedules.rezone({ ...move, zone: "UTC" }, live());
  assert.deepEqual(moved, { ...record, nextAtMs: 5 * hourMs, zone: "UTC", changedAtMs: 70 });
  assert.equal(await schedules.rezone({ ...move, zone: "Asia/Tokyo" }, live()), undefined);
}

async function skipsWhenTheInboxIsFull(subject: ScheduleSubject): Promise<void> {
  const { schedules, agentInbox, agentId } = subject;
  await created(subject, schedule(subject, 1));
  await fillAgentInbox(agentInbox, { agentId, session });
  const busy = await schedules.run(runOf(1, hourMs), live());
  assert.deepEqual(busy.ok && [busy.value.message, busy.value.schedule.lastRun?.reason], [
    undefined,
    "busy",
  ]);
}

async function refusesAborted(subject: ScheduleSubject): Promise<void> {
  const { schedules } = subject;
  await assertRefusesAborted(async (options) => schedules.create(schedule(subject, 1), options));
  await assertRefusesAborted(async (options) => schedules.run(runOf(1, hourMs), options));
  await assertRefusesAborted(async (options) => schedules.due({ atMs: 1, limit: 1 }, options));
  assert.deepEqual(await schedules.active({}, live()), []);
}

/** The checks every {@link ScheduleStore} passes. */
export function scheduleStoreContract(harness: ScheduleStoreHarness): readonly ContractCheck[] {
  const create = async () => harness.create();
  return [
    checkOn("stores schedules and lists the active and the due ones", create, storesAndLists),
    checkOn("holds at most 50 active schedules per agent", create, holdsFiftyActive),
    checkOn("cancels an active schedule once", create, cancelsOnce),
    checkOn("stores one wake-up at a time and moves the schedule on", create, runsAndWakesOnce),
    checkOn("records a skipped run and ends a schedule with no next run", create, skipsAndEnds),
    checkOn("refuses a run no longer due", create, refusesStaleRuns),
    checkOn(
      "moves a next run into a new zone only while it is expected",
      create,
      rezonesWhileExpected,
    ),
    checkOn("skips a run while the agent inbox is full", create, skipsWhenTheInboxIsFull),
    checkOn("refuses a call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
