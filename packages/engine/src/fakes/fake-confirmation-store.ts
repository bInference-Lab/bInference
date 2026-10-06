import { err, ok, type Result } from "@binference/core";
import type { IntentWrite, StoredIntent } from "../confirmations/stored-intent.js";
import type { ConfirmationStore } from "../ports.js";

/** A confirmation store for tests that keeps intents in memory and never touches a database. */
export interface FakeConfirmationStore extends ConfirmationStore {
  /** The writes that landed, oldest first, up to the last 1,000. */
  landed(): readonly IntentWrite[];
}

const maxLanded = 1_000;

function isStale(row: StoredIntent, write: IntentWrite): boolean {
  return (
    row.version !== write.version ||
    (write.confirmation !== undefined && row.confirmation !== undefined)
  );
}

function applied(row: StoredIntent, write: IntentWrite): StoredIntent {
  const { closing, confirmation } = write;
  return {
    ...row,
    status: write.step.status,
    version: row.version + 1,
    ...(closing === undefined ? {} : { closing }),
    ...(confirmation === undefined ? {} : { confirmation }),
  };
}

/**
 * Creates a {@link FakeConfirmationStore} holding the given intents. A write lands only while its
 * intent still has the version the write read, and an intent takes one confirmation at most. Every
 * call yields once before it reads or writes, so calls started together interleave as they would
 * against a database, and the check and the write of one call happen with nothing between them.
 * It keeps the last 1,000 writes that landed and drops older ones.
 */
export function createFakeConfirmationStore(
  intents: readonly StoredIntent[],
): FakeConfirmationStore {
  const rows = new Map(intents.map((stored) => [stored.intent, stored]));
  const landed: IntentWrite[] = [];
  return {
    async read(intent, options): Promise<StoredIntent | undefined> {
      options.signal.throwIfAborted();
      await Promise.resolve();
      return rows.get(intent);
    },
    async write(write, options): Promise<Result<StoredIntent, "stale">> {
      options.signal.throwIfAborted();
      await Promise.resolve();
      const row = rows.get(write.intent);
      if (row === undefined || isStale(row, write)) {
        return err("stale");
      }
      const next = applied(row, write);
      rows.set(write.intent, next);
      landed.push(write);
      if (landed.length > maxLanded) {
        landed.shift();
      }
      return ok(next);
    },
    landed: () => [...landed],
  };
}
