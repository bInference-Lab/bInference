import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import type { ContextSource } from "./ports.js";

/**
 * The {@link ContextSource} over the runtime's protocol client: `agent/readFile`, whose
 * `agent.file_missing` is a file the agent does not have; `skill/list` for the agent, where an
 * engine that does not serve it lists no skill; and `facts/get`. Any other failure rejects.
 */
export function createProtocolContextSource(client: Pick<ProtocolClient, "call">): ContextSource {
  return {
    async workspaceFile(place, signal) {
      try {
        const read = await client.call("agent/readFile", { ...place }, { signal });
        return read.text;
      } catch (error) {
        if (error instanceof BinferenceError && error.code === "agent.file_missing") {
          return undefined;
        }
        throw error;
      }
    },
    async skills(agent, signal) {
      try {
        const page = await client.call("skill/list", { agent }, { signal });
        return page.items.flatMap(({ name, description, location }) =>
          description === undefined || location === undefined
            ? []
            : [{ name, description, location }],
        );
      } catch (error) {
        if (error instanceof BinferenceError && error.code === "protocol.unknown_op") {
          return [];
        }
        throw error;
      }
    },
    async liveFacts(agent, signal) {
      return client.call("facts/get", { agent }, { signal });
    },
  };
}
