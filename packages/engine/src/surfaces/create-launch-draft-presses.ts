import type { LaunchDraftDesk, LaunchDraftStanding } from "../launches/launch-draft-desk.js";
import { type OwnerIdOf, pressedByOwner } from "./pressed-by-owner.js";

/** A press of a launch draft's button in Telegram, as the engine receives it (decision 0285). */
export interface LaunchDraftPress {
  /** The draft's button reference, from the button's data. */
  readonly ref: string;
  /** Start launch, or Drop. */
  readonly start: boolean;
  /** The presser's numeric Telegram id; the engine answers only for the owner's. */
  readonly presserId: number;
}

/** The engine's side of the owner's presses of launch draft buttons in Telegram. */
export interface LaunchDraftPresses {
  /** Starts or drops the draft for a press, and says how it stands. Rejects once the signal aborts. */
  answer(
    press: LaunchDraftPress,
    options: { readonly signal: AbortSignal },
  ): Promise<LaunchDraftStanding>;
}

/** What {@link createLaunchDraftPresses} answers through. */
export interface LaunchDraftPressesOptions {
  readonly desk: Pick<LaunchDraftDesk, "start" | "drop">;
  /** The owner's numeric Telegram id, or `undefined` before the owner pairs. */
  readonly ownerId: OwnerIdOf;
}

/**
 * Creates the {@link LaunchDraftPresses}, the engine's adapter of Telegram's `LaunchDraftAnswers`
 * port. A press by anyone but the owner answers `unknown` and changes nothing; the owner's Start
 * proposes the draft's launch as the owner on Telegram, the one proposal the owner's chat makes
 * (decision 0285), and Drop ends it.
 */
export function createLaunchDraftPresses(options: LaunchDraftPressesOptions): LaunchDraftPresses {
  return {
    async answer(press, { signal }) {
      if (!(await pressedByOwner(options.ownerId, press.presserId, signal))) {
        return { status: "unknown" };
      }
      return press.start
        ? options.desk.start(press.ref, { userId: press.presserId }, { signal })
        : options.desk.drop(press.ref);
    },
  };
}
