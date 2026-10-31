import { createPrivateKey, createPublicKey } from "node:crypto";
import { BinferenceError } from "@binference/core";
import { createPrivyApi, type PrivyApi } from "../privy/privy-api.js";
import type { PrivyApiOptions } from "../privy/privy-client.js";
import type { PrivyId, WalletRecord } from "../privy/privy-records.js";
import type { OwnerAuthorize } from "../wallets/rule-plans.js";
import type { LeftoverBook } from "./leftover-book.js";
import type { LeftoverRecord } from "./leftover-record.schema.js";
import { createLeftoverRemovals, type LeftoverRemovals } from "./leftover-removals.js";
import { ownerSigner } from "./owner-signer.js";

/** What a sweep removed, or would remove on a dry run, and what Privy kept. */
export interface SweepCounts {
  /** The kept records the sweep read. */
  readonly records: number;
  readonly walletsDetached: number;
  readonly policiesDeleted: number;
  readonly aggregationsDeleted: number;
  readonly quorumsDeleted: number;
  /** Key quorums Privy kept, such as one that owns a wallet: Privy deletes no wallet. */
  readonly quorumsKept: number;
  /** Policies and aggregations Privy kept; their records stay for the next sweep. */
  readonly othersKept: number;
  /** Records removed with their keys, once everything they name that needs the key was gone. */
  readonly recordsCleared: number;
}

/** Which records a sweep reads, and from which Privy test app. */
export interface LeftoverSweep {
  readonly privy: PrivyApiOptions;
  readonly book: LeftoverBook;
  /** Only this record, as a live run's own cleanup sweeps; every kept record when left out. */
  readonly only?: string;
  /** Reads and counts what the sweep would remove, and removes nothing. */
  readonly isDryRun?: boolean;
}

type Outcome = "removed" | "gone" | "kept";

interface Sweeper {
  readonly api: PrivyApi;
  readonly removals: LeftoverRemovals;
  readonly sweep: LeftoverSweep;
  readonly signal: AbortSignal;
}

/** The ids, one by one, through a step that removes each or, on a dry run, reads it. */
type Step = (id: PrivyId) => Promise<Outcome>;

const zero: SweepCounts = {
  records: 0,
  walletsDetached: 0,
  policiesDeleted: 0,
  aggregationsDeleted: 0,
  quorumsDeleted: 0,
  quorumsKept: 0,
  othersKept: 0,
  recordsCleared: 0,
};

// The most wallets a sweep reads for one owner key: the live suite makes a handful a run.
const maxWalletPages = 20;

// How long an aggregation's delete stays valid on Privy once the owner signs it.
const removalLifetimeMs = 5 * 60_000;

async function oneByOne(ids: readonly PrivyId[], step: Step): Promise<readonly Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const id of ids) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, as every write
    outcomes.push(await step(id));
  }
  return outcomes;
}

const countOf = (outcomes: readonly Outcome[], outcome: Outcome): number =>
  outcomes.filter((item) => item === outcome).length;

// The wallets a key quorum of the owner key owns, as Privy lists them a page at a time.
async function walletsOf(sweeper: Sweeper, ownerKey: string): Promise<readonly WalletRecord[]> {
  const wallets: WalletRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxWalletPages; page += 1) {
    const query = {
      authorizationKey: ownerKey,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page names the next
    const listed = await sweeper.api.listWallets(query, { signal: sweeper.signal });
    wallets.push(...listed.wallets);
    cursor = listed.nextCursor;
    if (cursor === undefined) {
      return wallets;
    }
  }
  return wallets;
}

// The policies a wallet holds: its own and its added signers' overrides.
function policiesOf(wallet: WalletRecord): readonly PrivyId[] {
  return [
    ...wallet.policyIds,
    ...wallet.signers.flatMap((signer) => signer.overridePolicyIds ?? []),
  ];
}

interface OwnerKeys {
  readonly authorize: OwnerAuthorize;
  /** The public half, DER SubjectPublicKeyInfo in base64. */
  readonly publicKey: string;
}

function ownerKeysOf(record: LeftoverRecord): OwnerKeys {
  const der = Buffer.from(record.ownerKey, "base64");
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return { authorize: ownerSigner(privateKey), publicKey: publicKey.toString("base64") };
}

function deleteAggregationStep(sweeper: Sweeper, authorize: OwnerAuthorize): Step {
  return async (aggregation) => {
    const expiresAtMs = sweeper.sweep.privy.clock.now() + removalLifetimeMs;
    try {
      const deleted = await sweeper.api.deleteAggregation(
        { aggregation, authorize, expiresAtMs },
        { signal: sweeper.signal },
      );
      if (deleted.ok) {
        return "removed";
      }
      return deleted.error === "not_found" ? "gone" : "kept";
    } catch (error) {
      // Privy refuses to delete an aggregation a policy's rule still compares with a 409.
      const isStillCompared =
        error instanceof BinferenceError &&
        error.code === "custody.privy_refused" &&
        error.details?.["status"] === 409;
      if (isStillCompared) {
        return "kept";
      }
      throw error;
    }
  };
}

interface Steps {
  readonly detach: Step;
  readonly policy: Step;
  readonly aggregation: Step;
  readonly quorum: Step;
}

// A dry run's read: what Privy still holds would be removed, the rest is gone.
async function found(read: Promise<{ readonly ok: boolean }>): Promise<Outcome> {
  return (await read).ok ? "removed" : "gone";
}

// What each kind of leftover goes through: Privy's removal, or a read on a dry run.
function stepsOf(sweeper: Sweeper, authorize: OwnerAuthorize): Steps {
  const owner = { authorize, signal: sweeper.signal };
  const { api, removals, signal } = sweeper;
  if (sweeper.sweep.isDryRun === true) {
    return {
      detach: async () => Promise.resolve("removed"),
      policy: async (id) => found(api.policy(id, { signal })),
      aggregation: async () => Promise.resolve("removed"),
      quorum: async (id) => found(api.keyQuorum(id, { signal })),
    };
  }
  return {
    detach: async (id) => removals.detachPolicies(id, owner),
    policy: async (id) => removals.deletePolicy(id, owner),
    aggregation: deleteAggregationStep(sweeper, authorize),
    quorum: async (id) => removals.deleteKeyQuorum(id, owner),
  };
}

// Sweeps one record in the order Privy allows: the wallets let their policies go, the policies
// go, then the aggregations no rule compares any more, then the key quorums that own nothing.
async function sweepRecord(sweeper: Sweeper, record: LeftoverRecord): Promise<SweepCounts> {
  const keys = ownerKeysOf(record);
  const steps = stepsOf(sweeper, keys.authorize);
  const holding = (await walletsOf(sweeper, keys.publicKey)).filter(
    (wallet) => policiesOf(wallet).length > 0 || wallet.signers.length > 0,
  );
  const detached = await oneByOne(
    holding.map((wallet) => wallet.id),
    steps.detach,
  );
  const policies = [...new Set([...record.policies, ...holding.flatMap(policiesOf)])];
  const policyOutcomes = await oneByOne(policies, steps.policy);
  const aggregationOutcomes = await oneByOne(record.aggregations, steps.aggregation);
  const quorumOutcomes = await oneByOne(record.quorums, steps.quorum);
  return {
    ...zero,
    walletsDetached: countOf(detached, "removed"),
    policiesDeleted: countOf(policyOutcomes, "removed"),
    aggregationsDeleted: countOf(aggregationOutcomes, "removed"),
    quorumsDeleted: countOf(quorumOutcomes, "removed"),
    quorumsKept: countOf(quorumOutcomes, "kept"),
    othersKept: countOf([...policyOutcomes, ...aggregationOutcomes], "kept"),
  };
}

function added(left: SweepCounts, right: SweepCounts): SweepCounts {
  return {
    records: left.records + right.records,
    walletsDetached: left.walletsDetached + right.walletsDetached,
    policiesDeleted: left.policiesDeleted + right.policiesDeleted,
    aggregationsDeleted: left.aggregationsDeleted + right.aggregationsDeleted,
    quorumsDeleted: left.quorumsDeleted + right.quorumsDeleted,
    quorumsKept: left.quorumsKept + right.quorumsKept,
    othersKept: left.othersKept + right.othersKept,
    recordsCleared: left.recordsCleared + right.recordsCleared,
  };
}

async function sweepNamed(sweeper: Sweeper, name: string): Promise<SweepCounts> {
  const { book, isDryRun } = sweeper.sweep;
  const record = await book.read(name, sweeper.signal);
  // A name the index lists with no readable record holds no key: it only leaves the index.
  const counts = {
    ...(record === undefined ? zero : await sweepRecord(sweeper, record)),
    records: 1,
  };
  if (isDryRun === true || counts.othersKept > 0) {
    return counts;
  }
  await book.forget(name, sweeper.signal);
  return { ...counts, recordsCleared: 1 };
}

/**
 * Removes what earlier live runs left on the Privy test app, with the owner keys their records
 * keep: each wallet those keys own lets its policies go, then the policies, the aggregations and
 * the key quorums are deleted, each signed by the owner key. A record goes, with its key, only
 * once every policy and aggregation it names is gone; a key quorum Privy keeps, such as one that
 * owns a wallet, never holds a record back. A busy app, refused credentials or a failing Privy
 * throw and leave the records for the next sweep.
 */
export async function sweepLeftovers(
  sweep: LeftoverSweep,
  signal: AbortSignal,
): Promise<SweepCounts> {
  const sweeper: Sweeper = {
    api: createPrivyApi(sweep.privy),
    removals: createLeftoverRemovals(sweep.privy),
    sweep,
    signal,
  };
  const names = sweep.only === undefined ? await sweep.book.names(signal) : [sweep.only];
  let counts = zero;
  for (const name of names) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one record at a time, as every write
    counts = added(counts, await sweepNamed(sweeper, name));
  }
  return counts;
}
