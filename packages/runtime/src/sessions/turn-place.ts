import type { Id } from "@binference/core";

/** Where one turn runs: its agent, its session, and the turn id the engine reserved for it. */
export interface TurnPlace {
  readonly agent: Id<"agt">;
  readonly session: Id<"ses">;
  readonly turn: Id<"trn">;
}
