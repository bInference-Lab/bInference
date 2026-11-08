import type { ChatStatusSource } from "../tools/agent-status-tool.js";
import type { HelperToolParts } from "../tools/helper-tools.js";
import type { ToolClient } from "../tools/tool-client.js";

/** What an agent's tools reach beyond their turn: the engine, the agent's helpers, its session. */
export interface TurnLink {
  readonly client: ToolClient;
  /** The helper tools' parts; a helper's own turn gets none, so it starts no helper. */
  readonly helpers?: HelperToolParts;
  /** What `agent_status` reads; a helper's turn gets one that sets no model (decision 0404). */
  readonly chats: ChatStatusSource;
}
