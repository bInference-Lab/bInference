import type { IdentityStore } from "../identity/ports.js";
import { memoryCall } from "./memory-call.js";
import type { MemoryIntentStore } from "./memory-intent-store.js";

/** Creates the in-memory {@link IdentityStore} that reads what the intent store's moves stored. */
export function createMemoryIdentityStore(
  intents: Pick<MemoryIntentStore, "identityNow">,
): IdentityStore {
  return { get: async (agent, call) => memoryCall(call, () => intents.identityNow(agent)) };
}
