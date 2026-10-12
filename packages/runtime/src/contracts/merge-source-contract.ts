import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { MergeSource } from "../loop/ports.js";

/** A fresh merge source of a running turn, with a way to add messages that wait and read them. */
export interface MergeSourceSubject {
  readonly merge: MergeSource;
  /** Adds `count` messages that wait, oldest first, and answers their ids in that order. */
  readonly wait: (count: number) => Promise<readonly string[]>;
  /** The ids of the messages that still wait, oldest first. */
  readonly waiting: () => Promise<readonly string[]>;
}

/** Makes a fresh subject for each check, in the chat mode it names (`chats.newMessageMode`). */
export interface MergeSourceHarness {
  create(options: { readonly mode: "merge" | "after" }): Promise<MergeSourceSubject>;
}

const live = (): AbortSignal => new AbortController().signal;

async function takesOldestFirst(harness: MergeSourceHarness): Promise<void> {
  const { merge, wait, waiting } = await harness.create({ mode: "merge" });
  const ids = await wait(3);
  const taken = await merge.take(live());
  assert.deepEqual(
    taken.map((message) => message.id),
    ids,
  );
  assert.deepEqual(await waiting(), []);
  assert.deepEqual(await merge.take(live()), []);
}

async function takesTwentyAtMost(harness: MergeSourceHarness): Promise<void> {
  const { merge, wait, waiting } = await harness.create({ mode: "merge" });
  const ids = await wait(22);
  const taken = await merge.take(live());
  assert.deepEqual(
    taken.map((message) => message.id),
    ids.slice(0, 20),
  );
  assert.deepEqual(await waiting(), ids.slice(20));
}

async function takesNoneAfter(harness: MergeSourceHarness): Promise<void> {
  const { merge, wait, waiting } = await harness.create({ mode: "after" });
  const ids = await wait(2);
  assert.deepEqual(await merge.take(live()), []);
  assert.deepEqual(await waiting(), ids);
}

async function refusesAborted(harness: MergeSourceHarness): Promise<void> {
  const { merge, wait, waiting } = await harness.create({ mode: "merge" });
  const ids = await wait(1);
  await assert.rejects(merge.take(AbortSignal.abort(new Error("the turn stopped"))));
  assert.deepEqual(await waiting(), ids);
}

/**
 * The contract every {@link MergeSource} keeps (runtime spec, section 3.4): in `merge` mode it
 * gives a turn the waiting messages, oldest first and at most 20, each once; in `after` mode none;
 * and on an aborted signal it rejects and leaves them waiting.
 */
export function mergeSourceContract(harness: MergeSourceHarness): readonly ContractCheck[] {
  return [
    {
      name: "gives the waiting messages oldest first, each once",
      run: async () => takesOldestFirst(harness),
    },
    {
      name: "gives at most 20 messages at one merge point",
      run: async () => takesTwentyAtMost(harness),
    },
    {
      name: "gives none in after mode and leaves them waiting",
      run: async () => takesNoneAfter(harness),
    },
    {
      name: "rejects on an aborted signal and leaves the messages waiting",
      run: async () => refusesAborted(harness),
    },
  ];
}
