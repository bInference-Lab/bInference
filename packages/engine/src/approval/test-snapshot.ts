import { createIdSource, type Id } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { createStoredIntents, type IntentSnapshot } from "../intents/create-stored-intents.js";
import type { TestEngine } from "../operations/test-engine.js";

/** A stored intent of a test engine as the engine reads it; an unknown one fails the test. */
export async function testSnapshot(test: TestEngine, intent: Id<"int">): Promise<IntentSnapshot> {
  const stored = createStoredIntents({
    intents: test.stores.intents,
    agents: test.stores.agents,
    ids: createIdSource({ clock: test.clock, random: createSeededRandom(9) }),
    publish: () => undefined,
  });
  const snapshot = await stored.snapshot(intent, { signal: new AbortController().signal });
  if (snapshot === undefined) {
    throw new Error(`Expected intent ${intent} to be stored.`);
  }
  return snapshot;
}
