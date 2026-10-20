import type { Id } from "@binference/core";

/** A photo the owner sent the bot with one of a turn's messages: the message, and its name. */
export interface TurnPhoto {
  readonly message: Id<"msg">;
  /** The `tg:<file_id>` the message names. */
  readonly image: string;
}

/**
 * Where one turn runs: its agent, its session, and the turn id the engine reserved for it, and the
 * photos the owner sent the bot with the messages it took, in order, which `launch_draft` names.
 */
export interface TurnPlace {
  readonly agent: Id<"agt">;
  readonly session: Id<"ses">;
  readonly turn: Id<"trn">;
  readonly photos?: readonly TurnPhoto[];
}
