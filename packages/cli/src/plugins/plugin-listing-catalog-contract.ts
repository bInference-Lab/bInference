import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { type ListingKind, openEnvelope } from "./listing-envelope.js";
import { listingFixture, listingIdFixture } from "./listing-fixtures.js";
import type { ListingKeys } from "./listing-keys.js";
import {
  type PluginListing,
  pluginListingSchema,
  revocationListSchema,
} from "./plugin-listing.schema.js";
import type { PluginListingCatalog } from "./ports.js";

/** A catalog under test and the listing keys its envelopes open with. */
interface PluginListingCatalogSubject {
  readonly catalog: PluginListingCatalog;
  readonly keys: ListingKeys;
}

/** Makes a fresh {@link PluginListingCatalogSubject} for each check. */
export interface PluginListingCatalogHarness {
  /** A catalog that serves these listings and a revocation list. */
  create(listings: readonly PluginListing[]): Promise<PluginListingCatalogSubject>;
  /** A catalog that no read reaches. */
  createDown(): Promise<PluginListingCatalogSubject>;
  /** A catalog whose reads never answer on their own, as a network that stops mid-read. */
  createHanging(): Promise<PluginListingCatalogSubject>;
}

const live = (): AbortSignal => new AbortController().signal;

// The payload of an envelope the subject's keys open, for the kind asked.
function payloadOf(
  subject: PluginListingCatalogSubject,
  envelope: string | undefined,
  kind: ListingKind,
) {
  assert.ok(envelope !== undefined, "expected an envelope");
  const read = openEnvelope(envelope, { kind, keys: subject.keys });
  assert.ok(read.ok, "expected the envelope to open with the keys in force");
  return read.value.payload;
}

async function findsListed(harness: PluginListingCatalogHarness): Promise<void> {
  const listing = listingFixture();
  const subject = await harness.create([listing]);
  const found = await subject.catalog.find(listing.packageName, listing.packageVersion, live());
  const other = await subject.catalog.find(listing.packageName, "9.9.9", live());
  assert.ok(found.ok && other.ok, "expected answers");
  assert.equal(found.value.length, 1);
  const payload = payloadOf(subject, found.value[0], "pluginListing");
  assert.deepEqual(pluginListingSchema.parse(payload), listing);
  assert.deepEqual(other.value, []);
}

async function getsById(harness: PluginListingCatalogHarness): Promise<void> {
  const listing = listingFixture();
  const subject = await harness.create([listing]);
  const got = await subject.catalog.get(listing.listing, live());
  const none = await subject.catalog.get(listingIdFixture(99), live());
  assert.ok(got.ok && none.ok, "expected answers");
  assert.deepEqual(
    pluginListingSchema.parse(payloadOf(subject, got.value, "pluginListing")),
    listing,
  );
  assert.equal(none.value, undefined);
}

async function servesRevocations(harness: PluginListingCatalogHarness): Promise<void> {
  const subject = await harness.create([]);
  const answer = await subject.catalog.revocations(live());
  assert.ok(answer.ok, "expected an answer");
  const payload = payloadOf(subject, answer.value, "pluginRevocations");
  assert.ok(revocationListSchema.safeParse(payload).success, "expected a revocation list");
}

async function allUnreachable(
  subject: PluginListingCatalogSubject,
  signal: AbortSignal,
): Promise<void> {
  const listing = listingFixture();
  const answers = await Promise.all([
    subject.catalog.find(listing.packageName, listing.packageVersion, signal),
    subject.catalog.get(listing.listing, signal),
    subject.catalog.revocations(signal),
  ]);
  assert.deepEqual(
    answers.map((answer) => (answer.ok ? "answered" : answer.error)),
    ["unreachable", "unreachable", "unreachable"],
  );
}

// Starts every read, then aborts their signal while they wait.
async function abortedMidRead(subject: PluginListingCatalogSubject): Promise<void> {
  const stop = new AbortController();
  const listing = listingFixture();
  const reading = Promise.all([
    subject.catalog.find(listing.packageName, listing.packageVersion, stop.signal),
    subject.catalog.get(listing.listing, stop.signal),
    subject.catalog.revocations(stop.signal),
  ]);
  await Promise.resolve();
  stop.abort();
  const answers = await reading;
  assert.deepEqual(
    answers.map((answer) => (answer.ok ? "answered" : answer.error)),
    ["unreachable", "unreachable", "unreachable"],
  );
}

/** The contract every `PluginListingCatalog` adapter passes (decision 0433). */
export function pluginListingCatalogContract(
  harness: PluginListingCatalogHarness,
): readonly ContractCheck[] {
  return [
    {
      name: "answers the signed listings of a package version it lists, and none of another",
      run: async () => findsListed(harness),
    },
    {
      name: "answers a listing by its id, and nothing for an id it does not serve",
      run: async () => getsById(harness),
    },
    {
      name: "answers a revocation list the keys in force open",
      run: async () => servesRevocations(harness),
    },
    {
      name: "answers unreachable to a read whose signal has aborted, and throws nothing",
      run: async () =>
        allUnreachable(await harness.create([listingFixture()]), AbortSignal.abort()),
    },
    {
      name: "answers unreachable to every read while it cannot be reached",
      run: async () => allUnreachable(await harness.createDown(), live()),
    },
    {
      name: "answers unreachable to a read whose signal aborts while it waits",
      run: async () => abortedMidRead(await harness.createHanging()),
    },
  ];
}
