import assert from "node:assert/strict";
import { type Id, idSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { CardCopy } from "../surfaces/card-copy.js";
import type { CardCopyStore } from "../surfaces/ports.js";

/** A card version a copy belongs to, as the intent store keeps it. */
export type CardVersionKey = Pick<CardCopy, "ref" | "intent" | "cardVersion">;

/**
 * Makes a fresh card copy store for each check, holding no copy, with the card versions the check
 * names stored first, as the intent store stores each version before a surface shows it.
 */
export interface CardCopyStoreHarness {
  create(cards: readonly CardVersionKey[]): Promise<CardCopyStore>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const intent: Id<"int"> = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const otherIntent: Id<"int"> = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const first: CardCopy = {
  ref: "AAAAAAAAAAAAAAAA",
  intent,
  cardVersion: 1,
  chatId: 7_012_345_678,
  messageId: 1001,
  sentAtMs: 1_000,
};
const second: CardCopy = {
  ...first,
  ref: "BBBBBBBBBBBBBBBB",
  cardVersion: 2,
  messageId: 1002,
  sentAtMs: 2_000,
};
const elsewhere: CardCopy = {
  ...first,
  ref: "CCCCCCCCCCCCCCCC",
  intent: otherIntent,
  messageId: 1003,
  sentAtMs: 3_000,
};
const cards: readonly CardVersionKey[] = [first, second, elsewhere];

async function startsEmpty(store: CardCopyStore): Promise<void> {
  assert.deepEqual(await store.find(first.ref, live()), []);
  assert.deepEqual(await store.ofIntent(intent, live()), []);
}

async function findsByRef(store: CardCopyStore): Promise<void> {
  const inGroup = { ...first, chatId: -100, messageId: 7, sentAtMs: 1_500 };
  await store.keep(first, live());
  await store.keep(inGroup, live());
  await store.keep(first, live());
  assert.deepEqual(await store.find(first.ref, live()), [first, inGroup]);
  assert.deepEqual(await store.find(second.ref, live()), []);
}

async function listsByIntent(store: CardCopyStore): Promise<void> {
  await store.keep(second, live());
  await store.keep(elsewhere, live());
  await store.keep(first, live());
  assert.deepEqual(await store.ofIntent(intent, live()), [first, second]);
  assert.deepEqual(await store.ofIntent(otherIntent, live()), [elsewhere]);
}

async function refusesAborted(store: CardCopyStore): Promise<void> {
  const reason = new Error("stopped by the caller");
  const stopped = { signal: AbortSignal.abort(reason) };
  await assert.rejects(store.keep(first, stopped), reason);
  await assert.rejects(store.find(first.ref, stopped), reason);
  await assert.rejects(store.ofIntent(intent, stopped), reason);
  assert.deepEqual(await store.find(first.ref, live()), []);
}

/** The contract every `CardCopyStore` adapter passes. */
export function cardCopyStoreContract(harness: CardCopyStoreHarness): readonly ContractCheck[] {
  const on =
    (run: (store: CardCopyStore) => Promise<void>): (() => Promise<void>) =>
    async () =>
      run(await harness.create(cards));
  return [
    { name: "finds no copy before one is kept", run: on(startsEmpty) },
    { name: "finds a card version's copies by its reference, each once", run: on(findsByRef) },
    { name: "lists an intent's copies, the oldest card version first", run: on(listsByIntent) },
    { name: "refuses every call on an aborted signal and keeps nothing", run: on(refusesAborted) },
  ];
}
