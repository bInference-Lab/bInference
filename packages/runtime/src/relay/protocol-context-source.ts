import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import type { ContextSource } from "./ports.js";

/**
 * The {@link ContextSource} over the runtime's protocol client: `agent/readFile`, whose
 * `agent.file_missing` is a file the agent does not have, and `facts/get`. Any other failure
 * rejects.
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
    async liveFacts(agent, signal) {
      return client.call("facts/get", { agent }, { signal });
    },
  };
}
