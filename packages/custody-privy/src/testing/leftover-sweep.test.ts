import { generateKeyPairSync } from "node:crypto";
import { createSecret, err, type SecretStore } from "@binference/core";
import {
  createManualClock,
  createMemorySecretStore,
  createSeededRandom,
} from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import {
  type CustodySetup,
  heldCapsOf,
  type PrivyCustodySubject,
  setUp,
  testCeiling,
} from "../contracts/privy-custody-setup.js";
import { createPrivyApi, type PrivyApi } from "../privy/privy-api.js";
import type { PrivyApiOptions } from "../privy/privy-client.js";
import type { PrivyId } from "../privy/privy-records.js";
import { testCapPlan } from "./custody-fixtures.js";
import { createFakePrivy } from "./fake-privy.js";
import { createFakeSignerProcess } from "./fake-signer-process.js";
import { createKeepingPrivyApi } from "./keeping-privy-api.js";
import { createLeftoverBook, type LeftoverBook } from "./leftover-book.js";
import { createLeftoverRemovals } from "./leftover-removals.js";
import { type SweepCounts, sweepLeftovers } from "./leftover-sweep.js";
import { ownerSigner } from "./owner-signer.js";

const live = () => ({ signal: AbortSignal.timeout(5_000) });
const capCount = 1 + testCapPlan.approvals.length;

/** A live run on the Privy fake whose owner key a book keeps, and whose setup made its wallet. */
interface DeadRun {
  readonly subject: PrivyCustodySubject;
  readonly setup: CustodySetup;
  /** Privy's API with no notes, for what another key makes. */
  readonly api: PrivyApi;
  readonly options: PrivyApiOptions;
  readonly store: SecretStore;
  readonly book: LeftoverBook;
  readonly name: string;
}

async function keptRun(seed: number): Promise<DeadRun> {
  const clock = createManualClock(1_790_000_000_000);
  const privy = createFakePrivy({ clock, random: createSeededRandom(seed) });
  const options = { http: privy.http, clock, appId: privy.appId, appSecret: privy.appSecret };
  const store = createMemorySecretStore({});
  const book = createLeftoverBook(store);
  const owner = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const name = await book.keep(owner.privateKey, live().signal);
  const ownerKey = owner.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const api = createPrivyApi(options);
  const subject: PrivyCustodySubject = {
    api: createKeepingPrivyApi(api, { book, name, ownerKey }),
    signerProcess: createFakeSignerProcess(),
    strangerProcess: createFakeSignerProcess(),
    ownerKey,
    ownerAuthorize: ownerSigner(owner.privateKey),
    clock,
  };
  return { subject, setup: await setUp(subject), api, options, store, book, name };
}

async function sweepOf(run: DeadRun): Promise<SweepCounts> {
  return sweepLeftovers({ privy: run.options, book: run.book }, live().signal);
}

async function aggregationsOf(run: DeadRun): Promise<readonly PrivyId[]> {
  const record = await run.book.read(run.name, live().signal);
  return record?.aggregations ?? [];
}

// A policy of another key on the same app that compares the run's caps, so Privy refuses to
// delete them while it is there; the stranger's key deletes it.
async function strangersPolicy(run: DeadRun): Promise<() => Promise<string>> {
  const stranger = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = stranger.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const quorum = await run.api.createKeyQuorum({ publicKey, displayName: "another owner" }, live());
  const ceiling = testCeiling(heldCapsOf(run.setup));
  const policy = await run.api.createPolicy({ ceiling, owner: quorum.id }, live());
  const removals = createLeftoverRemovals(run.options);
  const authorize = ownerSigner(stranger.privateKey);
  return async () => removals.deletePolicy(policy.id, { authorize, ...live() });
}

describe("sweepLeftovers", () => {
  it("cleans what a run that died left, with the owner key its record keeps", async () => {
    const run = await keptRun(11);
    const made = await aggregationsOf(run);
    await expect(run.book.read(run.name, live().signal)).resolves.toMatchObject({
      quorums: [expect.any(String), expect.any(String)],
      policies: [expect.any(String)],
    });
    expect(made).toHaveLength(capCount);

    await expect(sweepOf(run)).resolves.toStrictEqual({
      records: 1,
      walletsDetached: 1,
      policiesDeleted: 1,
      aggregationsDeleted: capCount,
      quorumsDeleted: 1,
      quorumsKept: 1,
      othersKept: 0,
      recordsCleared: 1,
    });
    const again = await Promise.all(
      made.map(async (aggregation) =>
        run.api.deleteAggregation(
          { aggregation, authorize: run.subject.ownerAuthorize, expiresAtMs: 1_800_000_000_000 },
          live(),
        ),
      ),
    );
    expect(again).toStrictEqual(made.map(() => err("not_found")));
    await expect(run.book.names(live().signal)).resolves.toStrictEqual([]);
    await expect(run.store.read(run.name, live().signal)).resolves.toStrictEqual(err("not_found"));
  });

  it("deletes a policy its record lost before the aggregations it compares, so Privy answers no 409", async () => {
    const run = await keptRun(12);
    const record = await run.book.read(run.name, live().signal);
    const lost = JSON.stringify({ ...record, policies: [] });
    await run.store.write(run.name, createSecret(lost), live().signal);

    await expect(sweepOf(run)).resolves.toMatchObject({
      policiesDeleted: 1,
      aggregationsDeleted: capCount,
      othersKept: 0,
      recordsCleared: 1,
    });
  });

  it("keeps the record and its key until Privy confirms every aggregation gone", async () => {
    const run = await keptRun(13);
    const deleteStrangersPolicy = await strangersPolicy(run);

    await expect(sweepOf(run)).resolves.toMatchObject({
      aggregationsDeleted: 0,
      othersKept: capCount,
      recordsCleared: 0,
    });
    await expect(run.book.names(live().signal)).resolves.toStrictEqual([run.name]);
    await expect(aggregationsOf(run)).resolves.toHaveLength(capCount);
    await expect(deleteStrangersPolicy()).resolves.toBe("removed");
    await expect(sweepOf(run)).resolves.toMatchObject({
      aggregationsDeleted: capCount,
      othersKept: 0,
      recordsCleared: 1,
    });
    await expect(run.book.names(live().signal)).resolves.toStrictEqual([]);
  });

  it("counts what it would remove on a dry run and removes nothing", async () => {
    const run = await keptRun(14);
    const dryRun = { privy: run.options, book: run.book, isDryRun: true };

    await expect(sweepLeftovers(dryRun, live().signal)).resolves.toStrictEqual({
      records: 1,
      walletsDetached: 1,
      policiesDeleted: 1,
      aggregationsDeleted: capCount,
      quorumsDeleted: 2,
      quorumsKept: 0,
      othersKept: 0,
      recordsCleared: 0,
    });
    await expect(sweepOf(run)).resolves.toMatchObject({ walletsDetached: 1, recordsCleared: 1 });
  });

  it("sweeps only the record it names", async () => {
    const run = await keptRun(15);
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const otherName = await run.book.keep(other.privateKey, live().signal);
    const only = { privy: run.options, book: run.book, only: otherName };

    await expect(sweepLeftovers(only, live().signal)).resolves.toMatchObject({
      records: 1,
      policiesDeleted: 0,
      recordsCleared: 1,
    });
    await expect(run.book.names(live().signal)).resolves.toStrictEqual([run.name]);
  });
});
