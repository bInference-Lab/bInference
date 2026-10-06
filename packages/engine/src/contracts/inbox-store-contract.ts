import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { InboxDraft } from "../ingress/inbox-entry.js";
import type { InboxStore } from "../ports.js";
import { assertRefusesAborted, checkOn, inOrder, live } from "./store-fixtures.js";

/** Makes a fresh, empty inbox for each check. */
export interface InboxStoreHarness {
  create(): Promise<InboxStore>;
}

function update(n: number): InboxDraft {
  return {
    source: "telegram",
    sourceKey: `tg:7012345678:${String(n)}`,
    payload: { update_id: n, message: { text: `message ${String(n)}` } },
    receivedAtMs: 1_000 + n,
  };
}

async function admitAll(inbox: InboxStore, numbers: readonly number[]): Promise<readonly number[]> {
  return inOrder(numbers, async (n) => (await inbox.admit(update(n), live())).entry.id);
}

async function admitsOnce(inbox: InboxStore): Promise<void> {
  const first = await inbox.admit(update(1), live());
  assert.equal(first.kind, "new");
  assert.deepEqual(first.entry, { ...update(1), id: first.entry.id });
  const again = await inbox.admit(
    { ...update(1), payload: "a later copy", receivedAtMs: 9 },
    live(),
  );
  assert.deepEqual(again, { kind: "repeat", entry: first.entry });
  const webhook = await inbox.admit({ ...update(2), source: "webhook" }, live());
  assert.equal(webhook.kind, "new");
  assert.notEqual(webhook.entry.id, first.entry.id);
}

async function resumesUnhandled(inbox: InboxStore): Promise<void> {
  const ids = await admitAll(inbox, [1, 2, 3, 4]);
  const [first, second, third] = ids;
  assert.ok(first !== undefined && second !== undefined && third !== undefined);
  const handled = await inbox.markHandled({ id: second, atMs: 2_000 }, live());
  assert.deepEqual(handled, { ok: true, value: { ...update(2), id: second, handledAtMs: 2_000 } });
  const pending = await inbox.unhandled(2, live());
  assert.deepEqual(
    pending.map((entry) => entry.id),
    [first, third],
  );
}

async function handlesOnce(inbox: InboxStore): Promise<void> {
  const { entry } = await inbox.admit(update(1), live());
  assert.ok((await inbox.markHandled({ id: entry.id, atMs: 2_000 }, live())).ok);
  const twice = await inbox.markHandled({ id: entry.id, atMs: 3_000 }, live());
  assert.deepEqual(twice, { ok: false, error: "handled" });
  const unknown = await inbox.markHandled({ id: entry.id + 100, atMs: 3_000 }, live());
  assert.deepEqual(unknown, { ok: false, error: "not_found" });
  assert.deepEqual(await inbox.unhandled(10, live()), []);
}

async function prunesHandled(inbox: InboxStore): Promise<void> {
  const [old, recent] = await admitAll(inbox, [1, 2, 3]);
  assert.ok(old !== undefined && recent !== undefined);
  await inbox.markHandled({ id: old, atMs: 1_500 }, live());
  await inbox.markHandled({ id: recent, atMs: 2_500 }, live());
  assert.equal(await inbox.prune(2_000, live()), 1);
  assert.equal((await inbox.markHandled({ id: old, atMs: 3_000 }, live())).ok, false);
  assert.deepEqual(await inbox.markHandled({ id: recent, atMs: 3_000 }, live()), {
    ok: false,
    error: "handled",
  });
  assert.equal((await inbox.unhandled(10, live())).length, 1);
  assert.equal((await inbox.admit(update(1), live())).kind, "new");
}

async function refusesAborted(inbox: InboxStore): Promise<void> {
  await assertRefusesAborted(async (options) => inbox.admit(update(1), options));
  await assertRefusesAborted(async (options) => inbox.unhandled(1, options));
  await assertRefusesAborted(async (options) => inbox.markHandled({ id: 1, atMs: 1 }, options));
  await assertRefusesAborted(async (options) => inbox.prune(1, options));
  assert.deepEqual(await inbox.unhandled(10, live()), []);
}

/** The contract every `InboxStore` adapter passes. */
export function inboxStoreContract(harness: InboxStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<InboxStore> => harness.create();
  return [
    checkOn("admits an event once and repeats its first entry", create, admitsOnce),
    checkOn(
      "lists the unhandled entries oldest first, at most the limit",
      create,
      resumesUnhandled,
    ),
    checkOn("marks an entry handled once", create, handlesOnce),
    checkOn("prunes only the entries handled before a time", create, prunesHandled),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
