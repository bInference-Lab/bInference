import { err } from "@binference/core";
import type { IntentStore } from "../ports.js";

/** An intent store wrapper whose freezes another write beats, and how often a freeze was tried. */
export interface BeatenFreezes {
  readonly wrap: (store: IntentStore) => IntentStore;
  readonly tries: () => number;
}

/** Wraps an intent store so that another write beats its first `times` freezes, each `stale`. */
export function beatenFreezes(times: number): BeatenFreezes {
  const counted = { tries: 0 };
  const wrap = (store: IntentStore): IntentStore => ({
    ...store,
    async freeze(write, call) {
      counted.tries += 1;
      return counted.tries <= times ? err("stale") : store.freeze(write, call);
    },
  });
  return { wrap, tries: () => counted.tries };
}
