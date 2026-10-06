import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { ConfigChange } from "../audit/config-change.js";
import type { ConfigJournal } from "../ports.js";
import { assertRefusesAborted, checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

/** Makes a fresh, empty config journal for each check. */
export interface ConfigJournalHarness {
  create(): Promise<ConfigJournal>;
}

const changes: readonly ConfigChange[] = [
  {
    atMs: 1_000,
    by: fixtureId("dev", 1),
    surface: "console",
    path: "agents.main.limits.perTradeUsd",
    before: 100,
    after: 250,
    reason: "raise the per-trade cap",
  },
  { atMs: 2_000, by: "telegram", surface: "telegram", path: "agents.main.locale", after: "zh" },
  { atMs: 3_000, by: "engine", surface: "cli", path: "telegram.topics", before: null },
];

async function recordsInOrder(journal: ConfigJournal): Promise<void> {
  const recorded = await inOrder(changes, async (change) => journal.record(change, live()));
  assert.deepEqual(
    recorded,
    changes.map((change, index) => ({ ...change, id: recorded[index]?.id })),
  );
  const ids = recorded.map((entry) => entry.id);
  assert.deepEqual(
    ids,
    ids.toSorted((left, right) => left - right),
  );
  const [first, second] = recorded;
  assert.ok(first !== undefined && second !== undefined);
  assert.deepEqual(await journal.list({ after: 0, limit: 2 }, live()), [first, second]);
  assert.deepEqual(await journal.list({ after: second.id, limit: 2 }, live()), [recorded[2]]);
}

async function refusesAborted(journal: ConfigJournal): Promise<void> {
  const [change] = changes;
  assert.ok(change !== undefined);
  await assertRefusesAborted(async (options) => journal.record(change, options));
  await assertRefusesAborted(async (options) => journal.list({ after: 0, limit: 1 }, options));
  assert.deepEqual(await journal.list({ after: 0, limit: 10 }, live()), []);
}

/** The contract every `ConfigJournal` adapter passes. */
export function configJournalContract(harness: ConfigJournalHarness): readonly ContractCheck[] {
  const create = async (): Promise<ConfigJournal> => harness.create();
  return [
    checkOn("records changes in order and lists them page by page", create, recordsInOrder),
    checkOn("refuses every call on an aborted signal and records nothing", create, refusesAborted),
  ];
}
