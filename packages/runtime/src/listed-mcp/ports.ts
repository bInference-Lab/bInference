import type { ListedMcpServer } from "./listing.schema.js";

/**
 * Where the composition root reads the MCP listings in force for the install (decision 0428): the
 * reviewed listings with each agent's switches, or none for a root that offers no listed server.
 * Each listing it answers is checked again before the runtime sees it.
 */
export interface ListedMcpSource {
  /** The listings in force now, each with the agents that have it on. */
  current(): readonly ListedMcpServer[];
  /** Calls `listener` after each change of {@link current}; the function it answers stops it. */
  watch(listener: () => void): () => void;
}
