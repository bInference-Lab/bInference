import type { Id } from "@binference/core";
import { type ProtocolId, protocolIdSchema } from "@binference/protocol";
import { z } from "zod";

/** An agent's listing that rests or has a tool off, as the `health` line names it (decision 0428). */
export interface ListedMcpState {
  readonly agent: Id<"agt">;
  readonly listing: ProtocolId<"mcpListing">;
  readonly state: "resting" | "off";
  /** Why: the latest failure's reason while it rests, or why its tool is off. */
  readonly reason: string;
  /** The tool that is off, by its `as`. */
  readonly tool?: string;
}

/** Reads a {@link ListedMcpState} of a `health` line. */
export const listedMcpStateSchema: z.ZodType<ListedMcpState, ListedMcpStateWire> = z.strictObject({
  agent: protocolIdSchema("agent"),
  listing: protocolIdSchema("mcpListing"),
  state: z.enum(["resting", "off"]),
  reason: z.string().min(1).max(32),
  tool: z.string().min(1).max(40).exactOptional(),
});

/** A {@link ListedMcpState} as JSON carries it. */
export interface ListedMcpStateWire extends Omit<ListedMcpState, "agent" | "listing"> {
  readonly agent: string;
  readonly listing: string;
}
