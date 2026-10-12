import type { ProtocolClient } from "@binference/client";
import type { Id } from "@binference/core";

/** The protocol client calls an agent's tools make, over the runtime's connection to the engine. */
export type ToolClient = Pick<ProtocolClient, "call">;

/** Who an agent's tools act for, and how they reach the engine. */
export interface AgentToolParts {
  /**
   * The agent whose turns call the tools. Every call names it; the model never names an agent, and
   * names no wallet, so the engine acts from this agent's default wallet (decision 0176).
   */
  readonly agent: Id<"agt">;
  readonly client: ToolClient;
}
