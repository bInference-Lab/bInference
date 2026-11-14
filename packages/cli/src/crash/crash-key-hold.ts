import type { IdempotencyStore } from "@binference/engine";
import { z } from "zod";

/** The first write of `op` the crash engine holds at `step` (decision 0437). */
export interface KeyHold {
  /** A protocol write, such as `intent/propose`. */
  readonly op: string;
  /**
   * Once its key is marked started, before its work runs (`marked`), or once its work answered,
   * before its result is stored (`finishing`).
   */
  readonly step: "marked" | "finishing";
}

/** What the crash engine writes on its own line once it holds the write. */
export const keyHeldMark = '"crashKeyHeld"';

const keyHoldSchema = z.tuple([
  z.string().regex(/^[a-z]+\/[a-zA-Z]+$/u),
  z.enum(["marked", "finishing"]),
]);

/** The hold `CRASH_KEY_HOLD` names: the operation and the step, a space between them. */
export function keyHoldOf(text: string): KeyHold {
  const [op, step] = keyHoldSchema.parse(text.split(" "));
  return { op, step };
}

/** The value of `CRASH_KEY_HOLD` that names the hold. */
export function keyHoldText(hold: KeyHold): string {
  return `${hold.op} ${hold.step}`;
}

// The write never goes on: the test kills the engine while it waits here.
async function heldForGood(): Promise<never> {
  return new Promise<never>(() => undefined);
}

/**
 * The idempotency store the crash engine's server keeps its keys in: the engine's own, but the
 * first write of the hold's operation stops at the hold's step for good. Once its key is marked
 * started in the store, or once its result is to be stored, the engine says so on a line of its
 * own holding {@link keyHeldMark}, and the test kills it there: the key stays started and no
 * result is stored, as a stop leaves a write cut at that moment.
 */
export function holdingKeys(
  hold: KeyHold,
  say: (line: string) => void,
): (store: IdempotencyStore) => IdempotencyStore {
  const state = { isTaken: false };
  const isHeld = (op: string, step: KeyHold["step"]): boolean => {
    if (state.isTaken || op !== hold.op || step !== hold.step) {
      return false;
    }
    state.isTaken = true;
    say(`${JSON.stringify({ crashKeyHeld: step, op })}\n`);
    return true;
  };
  return (store) => ({
    async start(mark, call) {
      const started = await store.start(mark, call);
      return started.kind === "started" && isHeld(mark.op, "marked") ? heldForGood() : started;
    },
    async finish(entry, call) {
      return isHeld(entry.op, "finishing") ? heldForGood() : store.finish(entry, call);
    },
    forget: async (lookup, call) => store.forget(lookup, call),
    prune: async (prune, call) => store.prune(prune, call),
  });
}
