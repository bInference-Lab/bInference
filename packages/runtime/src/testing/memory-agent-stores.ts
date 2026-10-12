import { idSchema, type Id } from "@binference/core";
import {
  createMemoryAgentDatabase,
  createMemoryChatQueueStore,
  createMemorySessionStore,
  createMemoryTranscriptStore,
  createMemoryWriterFence,
  type MemoryAgentDatabase,
} from "@binference/store/testing";
import type { AgentStores } from "../sessions/agent-stores.js";

/** In-memory stores of `agent.sqlite` with the fence raised, and the rows they share. */
export interface MemoryAgentStores {
  readonly stores: AgentStores;
  readonly database: MemoryAgentDatabase;
  /** Raises the fence again, as a later runtime start does, and answers the stores it writes with. */
  restart(): Promise<AgentStores>;
}

/** The `n`th id of a kind in a test, the same for the same `n`. */
export function nthTestId<P extends string>(prefix: P, n: number): Id<P> {
  const tail = n.toString(16).padStart(12, "0");
  return idSchema(prefix).parse(`${prefix}_0190f1c2-3a4b-7c5d-8e6f-${tail}`);
}

async function storesOn(database: MemoryAgentDatabase): Promise<AgentStores> {
  const fence = await createMemoryWriterFence(database).raise({
    signal: new AbortController().signal,
  });
  return {
    sessions: createMemorySessionStore(database),
    transcript: createMemoryTranscriptStore(database),
    queue: createMemoryChatQueueStore(database),
    fence,
  };
}

/** Creates an empty in-memory agent database and raises its fence, as a runtime start does. */
export async function createMemoryAgentStores(
  database: MemoryAgentDatabase = createMemoryAgentDatabase(),
): Promise<MemoryAgentStores> {
  return {
    stores: await storesOn(database),
    database,
    restart: async () => storesOn(database),
  };
}
