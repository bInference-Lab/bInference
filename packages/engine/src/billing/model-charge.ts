import type { Id } from "@binference/core";

/** The cost of one model call to charge to an agent, as the agent runtime records it. */
export interface ModelCharge {
  readonly agent: Id<"agt">;
  readonly model: string;
  /** The call's cost in micro-dollars, 0 or more. */
  readonly usdMicros: bigint;
  readonly atMs: number;
}
