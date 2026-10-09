import assert from "node:assert/strict";
import { assetRefSchema } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { RiskCacheStore } from "../ports.js";
import type { CachedRiskReport } from "../risk/cached-risk-report.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

/** A fresh, empty risk cache, the source ids it keeps reports for, and one it refuses. */
export interface RiskCacheStoreSubject {
  readonly store: RiskCacheStore;
  /** Two source ids the store keeps reports for. */
  readonly sources: readonly [string, string];
  /** A source id the store keeps no reports for. */
  readonly refused: string;
}

/** Makes a fresh {@link RiskCacheStoreSubject} for each check. */
export interface RiskCacheStoreHarness {
  create(): Promise<RiskCacheStoreSubject>;
}

const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const other = assetRefSchema.parse("fake:1/token:0x0000000b");

function entryOf(source: string, fetchedAtMs: number): CachedRiskReport {
  const report = { flags: ["mintable", "proxy"], liquidityUsdMicros: 25_000_000_000n } as const;
  return { asset: token, source, report, fetchedAtMs };
}

async function keepsEachSourcesReport(subject: RiskCacheStoreSubject): Promise<void> {
  const { store, sources } = subject;
  const [first, second] = sources;
  assert.equal(await store.read({ asset: token, source: first }, live()), undefined);
  await store.write(entryOf(first, 1_000), live());
  await store.write({ ...entryOf(second, 2_000), report: { flags: [] } }, live());
  assert.deepEqual(
    await store.read({ asset: token, source: first }, live()),
    entryOf(first, 1_000),
  );
  assert.deepEqual(await store.read({ asset: token, source: second }, live()), {
    ...entryOf(second, 2_000),
    report: { flags: [] },
  });
  assert.equal(await store.read({ asset: other, source: first }, live()), undefined);
}

async function replacesInPlace(subject: RiskCacheStoreSubject): Promise<void> {
  const [source] = subject.sources;
  await subject.store.write(entryOf(source, 1_000), live());
  const later = { ...entryOf(source, 5_000), report: { flags: ["honeypot"] } } as const;
  await subject.store.write(later, live());
  assert.deepEqual(await subject.store.read({ asset: token, source }, live()), later);
}

async function refusesUnknownSource(subject: RiskCacheStoreSubject): Promise<void> {
  const { store, refused } = subject;
  await assert.rejects(store.write(entryOf(refused, 1_000), live()), { code: "store.constraint" });
  assert.equal(await store.read({ asset: token, source: refused }, live()), undefined);
}

async function refusesAborted(subject: RiskCacheStoreSubject): Promise<void> {
  const [source] = subject.sources;
  await assertRefusesAborted(async (options) => subject.store.write(entryOf(source, 1), options));
  await assertRefusesAborted(async (options) =>
    subject.store.read({ asset: token, source }, options),
  );
  assert.equal(await subject.store.read({ asset: token, source }, live()), undefined);
}

/** The contract every `RiskCacheStore` adapter passes. */
export function riskCacheStoreContract(harness: RiskCacheStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<RiskCacheStoreSubject> => harness.create();
  return [
    checkOn("keeps each source's report for each token apart", create, keepsEachSourcesReport),
    checkOn("replaces a source's report for a token in place", create, replacesInPlace),
    checkOn(
      "refuses a source it keeps no reports for, and stores nothing",
      create,
      refusesUnknownSource,
    ),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
