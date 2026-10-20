import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { DailySummaryRecord } from "../summaries/daily-summary-record.js";
import type { DailySummaryStore } from "../summaries/ports.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** Makes a fresh daily summary store that holds agents 1 and 2 of the fixtures, and no summary. */
export interface DailySummaryStoreHarness {
  create(): Promise<DailySummaryStore>;
}

const first = fixtureId("agt", 1);
const second = fixtureId("agt", 2);
const atMs = 1_800_000_000_000;

function summary(date: string, change: Partial<DailySummaryRecord> = {}): DailySummaryRecord {
  return { agentId: first, date, atMs, outcome: "sent", ...change };
}

async function claimsEachDateOnce(store: DailySummaryStore): Promise<void> {
  const sent = summary("2026-10-20", { liveUsdMicros: 2n ** 64n + 1n, paperUsdMicros: 0n });
  assert.deepEqual(await store.claim(sent, live()), { ok: true, value: sent });
  const again = summary("2026-10-20", { outcome: "idle", atMs: atMs + 5 });
  assert.deepEqual(await store.claim(again, live()), { ok: false, error: "claimed" });
  assert.deepEqual(await store.latest(first, live()), sent);
  const other = summary("2026-10-20", { agentId: second, outcome: "idle" });
  assert.deepEqual(await store.claim(other, live()), { ok: true, value: other });
  assert.deepEqual(await store.latest(second, live()), other);
}

async function neverGoesBackADate(store: DailySummaryStore): Promise<void> {
  const later = summary("2026-10-21");
  assert.ok((await store.claim(later, live())).ok);
  const earlier = summary("2026-10-20", { atMs: atMs + 1 });
  assert.deepEqual(await store.claim(earlier, live()), { ok: false, error: "claimed" });
  const next = summary("2026-10-22", { atMs: atMs + 86_400_000, outcome: "idle" });
  assert.deepEqual(await store.claim(next, live()), { ok: true, value: next });
  assert.deepEqual(await store.latest(first, live()), next);
  assert.equal(await store.latest(second, live()), undefined);
}

async function refusesAnUnknownAgent(store: DailySummaryStore): Promise<void> {
  const stranger = summary("2026-10-20", { agentId: fixtureId("agt", 9) });
  await assert.rejects(store.claim(stranger, live()), { code: "store.constraint" });
  assert.equal(await store.latest(stranger.agentId, live()), undefined);
}

async function refusesAborted(store: DailySummaryStore): Promise<void> {
  const sent = summary("2026-10-20");
  await assertRefusesAborted(async (options) => store.claim(sent, options));
  await assertRefusesAborted(async (options) => store.latest(first, options));
  assert.equal(await store.latest(first, live()), undefined);
}

/** The contract every `DailySummaryStore` adapter passes. */
export function dailySummaryStoreContract(
  harness: DailySummaryStoreHarness,
): readonly ContractCheck[] {
  const create = async () => harness.create();
  return [
    checkOn("claims each agent's date once, its totals exact", create, claimsEachDateOnce),
    checkOn("claims no date at or before the agent's latest", create, neverGoesBackADate),
    checkOn("refuses a summary of an agent it does not hold", create, refusesAnUnknownAgent),
    checkOn("refuses every call on an aborted signal and keeps nothing", create, refusesAborted),
  ];
}
