import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { BotUpdate } from "../ingress/bot-update.js";
import type { BotUpdateSource } from "../ports.js";
import { assertRefusesAborted, live } from "./store-fixtures.js";

/** An update source under test, and how the bot's platform sends it one update. */
export interface BotUpdateSourceSubject {
  readonly source: BotUpdateSource;
  /** Sends one update to the bot, as the platform does when something happens in a chat. */
  post(update: BotUpdate): void;
}

/** Makes a fresh {@link BotUpdateSourceSubject} for each check. */
export interface BotUpdateSourceHarness {
  create(): BotUpdateSourceSubject;
}

const update = (updateId: number): BotUpdate => ({
  updateId,
  payload: { update_id: updateId, message: { text: `message ${String(updateId)}` } },
});

function postAll(subject: BotUpdateSourceSubject, ids: readonly number[]): void {
  for (const id of ids) {
    subject.post(update(id));
  }
}

const ids = (updates: readonly BotUpdate[]): readonly number[] => updates.map((u) => u.updateId);

const readChecks = (harness: BotUpdateSourceHarness): readonly ContractCheck[] => [
  {
    name: "answers the updates in the order of their ids, each with its payload",
    run: async () => {
      const subject = harness.create();
      postAll(subject, [11, 12, 13]);
      assert.deepEqual(await subject.source.next(live()), [update(11), update(12), update(13)]);
    },
  },
  {
    name: "answers an update again until it is acknowledged, and never after",
    run: async () => {
      const subject = harness.create();
      postAll(subject, [11, 12, 13]);
      assert.deepEqual(ids(await subject.source.next(live())), [11, 12, 13]);
      assert.deepEqual(ids(await subject.source.next(live())), [11, 12, 13]);
      await subject.source.acknowledge(12, live());
      assert.deepEqual(ids(await subject.source.next(live())), [13]);
    },
  },
  {
    name: "answers at most the limit it is given",
    run: async () => {
      const subject = harness.create();
      postAll(subject, [11, 12, 13]);
      assert.deepEqual(ids(await subject.source.next({ ...live(), limit: 2 })), [11, 12]);
    },
  },
  {
    name: "waits while there is no update, then answers the next one",
    run: async () => {
      const subject = harness.create();
      const waiting = subject.source.next(live());
      subject.post(update(21));
      assert.deepEqual(await waiting, [update(21)]);
    },
  },
];

const abortChecks = (harness: BotUpdateSourceHarness): readonly ContractCheck[] => [
  {
    name: "stops waiting with the signal's reason once the signal aborts",
    run: async () => {
      const { source } = harness.create();
      const controller = new AbortController();
      const reason = new Error("stopped");
      const waiting = source.next({ signal: controller.signal });
      controller.abort(reason);
      await assert.rejects(waiting, reason);
    },
  },
  {
    name: "answers and acknowledges nothing on an aborted signal",
    run: async () => {
      const subject = harness.create();
      postAll(subject, [11]);
      await assertRefusesAborted(async (options) => subject.source.next(options));
      await assertRefusesAborted(async (options) => subject.source.acknowledge(11, options));
      assert.deepEqual(ids(await subject.source.next(live())), [11]);
    },
  },
];

/** The contract every `BotUpdateSource` adapter passes. */
export function botUpdateSourceContract(harness: BotUpdateSourceHarness): readonly ContractCheck[] {
  return [...readChecks(harness), ...abortChecks(harness)];
}
