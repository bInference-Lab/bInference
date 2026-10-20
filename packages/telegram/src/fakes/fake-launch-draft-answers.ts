import type { LaunchDraftPress, LaunchDraftStanding } from "@binference/engine/surfaces";
import type { LaunchDraftAnswers } from "../ports.js";

/** The engine's side of launch draft presses in memory, with handles a test drives it by. */
export interface FakeLaunchDraftAnswers extends LaunchDraftAnswers {
  /** Opens a draft under its button reference. */
  open(ref: string): void;
  /** Every Start the engine took, in order: the launches it proposed. */
  started(): readonly LaunchDraftPress[];
}

/**
 * Creates the engine's side of launch draft presses in memory, for tests: the owner's first press
 * starts an open draft, answering `starting` as the engine does before its launch is proposed, or
 * drops it, and every later one finds none.
 */
export function createFakeLaunchDraftAnswers(options: {
  readonly ownerId: number;
}): FakeLaunchDraftAnswers {
  const open = new Set<string>();
  const started: LaunchDraftPress[] = [];
  const decide = (press: LaunchDraftPress): LaunchDraftStanding => {
    open.delete(press.ref);
    if (!press.start) {
      return { status: "dropped" };
    }
    started.push(press);
    return { status: "starting" };
  };
  return {
    answer: async (press, call) => {
      call.signal.throwIfAborted();
      const isOwner = press.presserId === options.ownerId;
      return Promise.resolve(
        open.has(press.ref) && isOwner ? decide(press) : { status: "unknown" },
      );
    },
    open: (ref) => {
      open.add(ref);
    },
    started: () => [...started],
  };
}
