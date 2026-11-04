import { err } from "@binference/core";
import type { IntentStore } from "../ports.js";

/**
 * Wraps an intent store so it loses moves into `state` to another writer, such as a cancel, as a
 * stale version: every such move, or only the first `times` of them.
 */
export function racedTo(state: string, times?: number): (store: IntentStore) => IntentStore {
  let lost = 0;
  return (store) => ({
    ...store,
    transition: async (change, options) => {
      if (change.state !== state || (times !== undefined && lost >= times)) {
        return store.transition(change, options);
      }
      lost += 1;
      return err("stale");
    },
  });
}
