import type { WriterFence } from "../ports.js";
import { inMemory, type MemoryAgentDatabase } from "./memory-agent-database.js";

/** The {@link WriterFence} of an in-memory agent database. */
export function createMemoryWriterFence(database: MemoryAgentDatabase): WriterFence {
  return {
    raise: async (options) => inMemory(options, () => database.fence.add(1)),
  };
}
