import type { ProtocolClient } from "@binference/client";
import type { Id } from "@binference/core";
import type { TurnPlace } from "../sessions/turn-place.js";
import type { WebToolParts } from "./web-tools.js";

/** The protocol client calls an agent's tools make, over the runtime's connection to the engine. */
export type ToolClient = Pick<ProtocolClient, "call">;

/** Who an agent's tools act for, and how they reach the engine. */
export interface AgentToolParts {
  /**
   * The agent whose turns call the tools. Every call names it; the model never names an agent, and
   * names no wallet, so the engine picks this agent's wallet: its launch wallet for a live trade on
   * a launch's own curve, else its default wallet (decisions 0176 and 0217).
   */
  readonly agent: Id<"agt">;
  readonly client: ToolClient;
  /** The turn the tools serve: its session and the turn id, where `ask_owner` asks. */
  readonly turn: Pick<TurnPlace, "session" | "turn">;
  /** How the web tools reach the internet; without it, the agent has no web tools. */
  readonly web?: WebToolParts;
}
