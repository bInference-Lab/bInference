import type { Id } from "@binference/core";
import type { IdentityRecord } from "./identity-record.js";

/**
 * Reads each agent's identity (database spec, `identities`; decision 0335). Nothing writes through
 * it: a registration's identity lands with its intent's move to `reconciled`, in the intent
 * store's transaction. Adapters: `identities` in engine.sqlite, and a fake over the in-memory
 * intent store.
 */
export interface IdentityStore {
  /**
   * The agent's identity, or `undefined` when it has none. A call on an aborted signal rejects
   * with its reason.
   */
  get(
    agent: Id<"agt">,
    options: { readonly signal: AbortSignal },
  ): Promise<IdentityRecord | undefined>;
}
