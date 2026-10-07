import type { Id } from "@binference/core";
import type { Executor } from "../ports.js";

/** An executor for tests that keeps the intents it took and never signs or sends. */
export interface FakeExecutor extends Executor {
  /** The intents taken, oldest first. */
  taken(): readonly Id<"int">[];
}

/** Creates a {@link FakeExecutor} that has taken nothing yet. */
export function createFakeExecutor(): FakeExecutor {
  const taken: Id<"int">[] = [];
  return {
    async take(intent, options) {
      options.signal.throwIfAborted();
      taken.push(intent);
      await Promise.resolve();
    },
    taken: () => [...taken],
  };
}
