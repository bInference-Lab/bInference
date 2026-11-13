import type { Logger } from "@binference/core";
import type { ListedMcpState } from "@binference/runtime";

/** Hears the listed MCP servers' states each `health` line names, and logs each change. */
export type ListedStateLog = (states: readonly ListedMcpState[]) => void;

function keyOf(state: ListedMcpState): string {
  return `${state.agent} ${state.listing} ${state.tool ?? ""}`;
}

/**
 * Logs `runtime.listed_mcp` each time an agent's listing starts to rest, has a tool turned off, or
 * comes back (decision 0428): the agent's id, the listing's id, the state and the reason, never a
 * word a server wrote. A state the next health line no longer names is logged `ok`.
 */
export function createListedStateLog(logger: Logger): ListedStateLog {
  let known = new Map<string, ListedMcpState>();
  return (states) => {
    const next = new Map(states.map((state) => [keyOf(state), state]));
    for (const [key, state] of next) {
      const before = known.get(key);
      if (before?.state !== state.state || before.reason !== state.reason) {
        const { agent, listing, reason } = state;
        logger.info("runtime.listed_mcp", { agentId: agent, listing, state: state.state, reason });
      }
    }
    for (const [key, state] of known) {
      if (!next.has(key)) {
        logger.info("runtime.listed_mcp", {
          agentId: state.agent,
          listing: state.listing,
          state: "ok",
        });
      }
    }
    known = next;
  };
}
