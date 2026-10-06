import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { IntentWrite, StoredIntent } from "../confirmations/stored-intent.js";
import type { ConfirmationStore } from "../ports.js";

/** A confirmation store under test, an intent it holds with an open card, and an unknown id. */
export interface ConfirmationStoreSubject {
  readonly store: ConfirmationStore;
  /** An intent in `awaiting_confirmation` with card version 1. */
  readonly held: StoredIntent;
  readonly unknown: Id<"int">;
}

/** Makes a fresh {@link ConfirmationStoreSubject} for each check. */
export interface ConfirmationStoreHarness {
  create(): ConfirmationStoreSubject;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

const triggers = {
  confirmed: "confirm_tapped",
  denied: "deny_tapped",
  executing: "queue_took",
} as const;

// A move of the held intent into `state`, under the version it was read at.
function moveTo(held: StoredIntent, state: keyof typeof triggers, atMs: number): IntentWrite {
  return {
    intent: held.intent,
    version: held.version,
    step: {
      status: { ...held.status, state, changedAtMs: atMs },
      event: {
        from: held.status.state,
        to: state,
        trigger: triggers[state],
        atMs,
        hasLedgerEntry: true,
      },
    },
  };
}

function confirmedAt(held: StoredIntent, version: number): IntentWrite {
  const atMs = held.status.changedAtMs + 1_000;
  return {
    ...moveTo(held, "confirmed", atMs),
    version,
    closing: { outcome: "confirmed", answeredBy: { surface: "telegram", by: "owner" }, atMs },
    confirmation: { cardVersion: 1, expiresAtMs: atMs + 60_000 },
  };
}

const readChecks = (harness: ConfirmationStoreHarness): readonly ContractCheck[] => [
  {
    name: "reads an intent it holds with its version and card rules",
    run: async () => {
      const { store, held } = harness.create();
      assert.deepEqual(await store.read(held.intent, live()), held);
    },
  },
  {
    name: "answers an unknown intent as undefined",
    run: async () => {
      const { store, unknown } = harness.create();
      assert.equal(await store.read(unknown, live()), undefined);
    },
  },
];

const writeChecks = (harness: ConfirmationStoreHarness): readonly ContractCheck[] => [
  {
    name: "stores a write under the version it read and moves the version on",
    run: async () => {
      const { store, held } = harness.create();
      const write = moveTo(held, "denied", held.status.changedAtMs + 1_000);
      const written = await store.write(write, live());
      assert.ok(written.ok);
      assert.deepEqual(written.value.status, write.step.status);
      assert.ok(written.value.version > held.version);
      assert.deepEqual(await store.read(held.intent, live()), written.value);
    },
  },
  {
    name: "refuses a write under a version that moved on and keeps the first",
    run: async () => {
      const { store, held } = harness.create();
      const first = await store.write(moveTo(held, "denied", 1), live());
      const late = await store.write(moveTo(held, "confirmed", 2), live());
      assert.deepEqual(late, { ok: false, error: "stale" });
      assert.ok(first.ok);
      assert.deepEqual(await store.read(held.intent, live()), first.value);
    },
  },
  {
    name: "lets exactly one of two writes under one version land",
    run: async () => {
      const { store, held } = harness.create();
      const writes = [moveTo(held, "denied", 1), confirmedAt(held, held.version)];
      const results = await Promise.all(writes.map(async (write) => store.write(write, live())));
      const landed = results.flatMap((result) => (result.ok ? [result.value] : []));
      assert.equal(landed.length, 1);
      assert.deepEqual(await store.read(held.intent, live()), landed[0]);
    },
  },
  {
    name: "answers a write for an unknown intent as stale",
    run: async () => {
      const { store, held, unknown } = harness.create();
      const write = { ...moveTo(held, "denied", 1), intent: unknown };
      assert.deepEqual(await store.write(write, live()), { ok: false, error: "stale" });
    },
  },
];

const confirmationChecks = (harness: ConfirmationStoreHarness): readonly ContractCheck[] => [
  {
    name: "keeps the card's closing and the confirmation with the step",
    run: async () => {
      const { store, held } = harness.create();
      const write = confirmedAt(held, held.version);
      await store.write(write, live());
      const stored = await store.read(held.intent, live());
      assert.ok(stored);
      assert.deepEqual(stored.closing, write.closing);
      assert.deepEqual(stored.confirmation, write.confirmation);
    },
  },
  {
    name: "takes one confirmation for an intent at most",
    run: async () => {
      const { store, held } = harness.create();
      const first = await store.write(confirmedAt(held, held.version), live());
      assert.ok(first.ok);
      const second = await store.write(confirmedAt(held, first.value.version), live());
      assert.deepEqual(second, { ok: false, error: "stale" });
    },
  },
  {
    name: "stores later writes without a confirmation after one",
    run: async () => {
      const { store, held } = harness.create();
      const first = await store.write(confirmedAt(held, held.version), live());
      assert.ok(first.ok);
      const later = moveTo(first.value, "executing", held.status.changedAtMs + 2_000);
      const written = await store.write(later, live());
      assert.ok(written.ok);
      assert.deepEqual(written.value.confirmation, first.value.confirmation);
    },
  },
  {
    name: "refuses to read or write on an aborted signal",
    run: async () => {
      const { store, held } = harness.create();
      const reason = new Error("stopped");
      const aborted = { signal: AbortSignal.abort(reason) };
      await assert.rejects(store.read(held.intent, aborted), reason);
      await assert.rejects(store.write(moveTo(held, "denied", 1), aborted), reason);
    },
  },
];

/**
 * The contract every `ConfirmationStore` adapter passes: writes land as a compare-and-set on the
 * row version, so of two answers that read one version, exactly one lands.
 */
export function confirmationStoreContract(
  harness: ConfirmationStoreHarness,
): readonly ContractCheck[] {
  return [...readChecks(harness), ...writeChecks(harness), ...confirmationChecks(harness)];
}
