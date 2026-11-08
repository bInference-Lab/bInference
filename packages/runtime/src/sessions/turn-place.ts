import type { Id } from "@binference/core";
import type { ChatSurface } from "@binference/protocol";

/** A photo the owner sent the bot with one of a turn's messages: the message, and its name. */
export interface TurnPhoto {
  readonly message: Id<"msg">;
  /** The `tg:<file_id>` the message names. */
  readonly image: string;
}

/**
 * Where one turn runs: its agent, its session, and the turn id the engine reserved for it, and the
 * photos the owner sent the bot with the messages it took, in order, which `launch_draft` names,
 * and the surface of the first owner's message it took, which an image job's end names.
 */
export interface TurnPlace {
  readonly agent: Id<"agt">;
  readonly session: Id<"ses">;
  readonly turn: Id<"trn">;
  readonly photos?: readonly TurnPhoto[];
  readonly surface?: ChatSurface;
  /**
   * The session's chat model, `<provider>/<model>`, which the agent set for the rest of the
   * session (decision 0404); absent, the turn runs on the configured model.
   */
  readonly chatModel?: string;
  /** The turn is a run of one of the agent's helpers, in the helper's own session (decision 0403). */
  readonly helper?: HelperTurn;
}

/** What a helper's turn runs with beyond the agent's: the model the agent named for it, if any. */
interface HelperTurn {
  /** `<provider>/<model>` of a configured provider; absent, the agent's own model. */
  readonly model?: string;
}
