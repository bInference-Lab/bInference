import type { TurnOutcome } from "@binference/store";
import type { TurnStatusLine } from "./turn-ports.js";

/**
 * Why a running turn is told to stop: the owner's `chat/stop`, a freeze, a `chat/clear`, or the
 * runtime's own stop (runtime spec, section 4.4).
 */
export type TurnStop = "owner" | "freeze" | "clear" | "runtime";

/**
 * Why a turn halted before its loop ended on its own: a stop, its 10 minutes, a mark the engine
 * did not take, or a proposal whose outcome is unknown.
 */
export type TurnHalt = TurnStop | "time_limit" | "engine" | "proposal_unknown";

const halts: ReadonlySet<string> = new Set<TurnHalt>([
  "owner",
  "freeze",
  "clear",
  "runtime",
  "time_limit",
  "engine",
  "proposal_unknown",
]);

function isHalt(reason: string): reason is TurnHalt {
  return halts.has(reason);
}

/** The halt a turn's signal aborted with; any reason the loop did not set counts as the runtime's. */
export function haltOf(signal: AbortSignal): TurnHalt {
  const reason: string = typeof signal.reason === "string" ? signal.reason : "";
  return isHalt(reason) ? reason : "runtime";
}

/** How a halted turn ends, and the status line that tells the owner why. */
export interface HaltEnd {
  readonly outcome: TurnOutcome;
  readonly status: TurnStatusLine;
}

const stops: ReadonlySet<TurnHalt> = new Set<TurnHalt>(["owner", "freeze", "clear", "runtime"]);

function isStop(halt: TurnHalt): halt is TurnStop {
  return stops.has(halt);
}

/** A stop ends the turn `stopped`; its time limit, the engine and an unknown proposal, `failed`. */
export function endOfHalt(halt: TurnHalt): HaltEnd {
  if (isStop(halt)) {
    return { outcome: "stopped", status: { line: "stopped" } };
  }
  return { outcome: "failed", status: { line: "failed", failure: halt } };
}
