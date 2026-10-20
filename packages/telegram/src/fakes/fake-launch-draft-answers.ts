import { type Id, idSchema } from "@binference/core";
import type { LaunchDraftPress, LaunchDraftStanding } from "@binference/engine/surfaces";
import type { LaunchDraftAnswers } from "../ports.js";

/** The engine's side of launch draft presses in memory, with handles a test drives it by. */
export interface FakeLaunchDraftAnswers extends LaunchDraftAnswers {
  /** Opens a draft under its button reference; a Start answers this standing. */
  open(ref: string, onStart?: LaunchDraftStanding): void;
  /** Every Start the engine took, in order: the launches it proposed. */
  started(): readonly LaunchDraftPress[];
}

const startedIntent: Id<"int"> = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000285");

/**
 * Creates the engine's side of launch draft presses in memory, for tests: the owner's first press
 * starts or drops an open draft, and every later one finds none.
 */
export function createFakeLaunchDraftAnswers(options: {
  readonly ownerId: number;
}): FakeLaunchDraftAnswers {
  const open = new Map<string, LaunchDraftStanding>();
  const started: LaunchDraftPress[] = [];
  const decide = (press: LaunchDraftPress, onStart: LaunchDraftStanding): LaunchDraftStanding => {
    open.delete(press.ref);
    if (!press.start) {
      return { status: "dropped" };
    }
    started.push(press);
    return onStart;
  };
  return {
    answer: async (press, call) => {
      call.signal.throwIfAborted();
      const onStart = open.get(press.ref);
      const isOwner = press.presserId === options.ownerId;
      return Promise.resolve(
        onStart === undefined || !isOwner ? { status: "unknown" } : decide(press, onStart),
      );
    },
    open: (ref, onStart = { status: "started", intent: startedIntent }) => {
      open.set(ref, onStart);
    },
    started: () => [...started],
  };
}
