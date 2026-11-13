import type { Clock, Logger, Random } from "@binference/core";
import type { TurnSetup } from "../chats/chat-context.js";
import type { StartLine } from "../control/control-line.schema.js";
import type { RuntimeSettings } from "../control/runtime-settings.schema.js";
import type { ContextSource, EngineChat, OwnerImageReader } from "../engine-chat/ports.js";
import type { ListedMcpState } from "../listed-mcp/listed-mcp-state.schema.js";
import type { TurnPlace } from "../sessions/turn-place.js";
import type { ToolClient } from "../tools/tool-client.js";
import type { AgentDatabase } from "./agent-database.js";
import type { TurnLink } from "./turn-link.js";

/** The runtime's signed-in link to the engine. */
export interface EngineLink {
  /** The engine's side of chat over this connection. */
  readonly chat: EngineChat;
  /** The workspace files and live facts each turn's context reads over this connection. */
  readonly context: ContextSource;
  /** The images of the owner's messages, which a turn reads over this connection. */
  readonly images: OwnerImageReader;
  /** The operations the agents' tools call over this connection. */
  readonly client: ToolClient;
  /** Closes the connection; the runtime holds no other. */
  close(): void;
}

/** What the runtime's entry hands over from Node: its pipes, how it reaches the engine, its timer. */
export interface RuntimeHost {
  /** The standard input: the engine's lines. */
  readonly input: AsyncIterable<Uint8Array>;
  /** Writes one line to the standard output, and resolves once it is written. */
  readonly write: (line: string) => Promise<void>;
  /** Signs in to the engine at the start line's endpoint with its token. */
  readonly connect: (start: StartLine, signal: AbortSignal) => Promise<EngineLink>;
  /** Opens `agent.sqlite` at the start line's path and migrates it. */
  readonly openAgentDatabase: (path: string, signal: AbortSignal) => Promise<AgentDatabase>;
  /**
   * What an agent's next turn runs with under the settings in force, its tools calling the engine
   * through the link's client for the place the turn runs in, and reaching the agent's helpers
   * (decision 0403); a helper's place gets a helper's setup.
   */
  readonly turnSetup: (place: TurnPlace, settings: RuntimeSettings, link: TurnLink) => TurnSetup;
  /**
   * Puts what the process itself holds of the settings in force, such as the route of its
   * outbound requests: with the start line's settings, then with each settings line.
   */
  readonly applySettings?: (settings: RuntimeSettings) => void;
  /**
   * Each agent's listing that rests or has a tool off (decision 0428), which every `health` line
   * names; none when absent.
   */
  readonly listedMcpStates?: () => readonly ListedMcpState[];
  /** Random bytes for the ids of the agents' helpers and their turns. */
  readonly random: Random;
  readonly clock: Clock;
  /** Hears what the runtime leaves undone, such as a message its chat could not take. */
  readonly logger: Logger;
  /** Calls `onTick` every 10 seconds until the signal aborts: when the runtime writes its health. */
  readonly everyTenSeconds: (onTick: () => Promise<void>, signal: AbortSignal) => void;
  /** This build's release. */
  readonly version: string;
}
