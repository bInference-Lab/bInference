import { err, ok } from "@binference/core";
import { type QueuedMessage, takenBy } from "../chats/queued-message.js";
import type { ChatQueueStore } from "../ports.js";
import { holdsFence, inMemory, type MemoryAgentDatabase } from "./memory-agent-database.js";

const isWaiting = (message: QueuedMessage | undefined): message is QueuedMessage =>
  message !== undefined && message.turnId === undefined && message.droppedAtMs === undefined;

const byArrival = (left: QueuedMessage, right: QueuedMessage): number =>
  left.receivedAtMs - right.receivedAtMs || (left.message < right.message ? -1 : 1);

// Adding a message once, and reading those that wait.
function arrivals(database: MemoryAgentDatabase): Pick<ChatQueueStore, "add" | "waiting"> {
  const { queue } = database;
  return {
    add: async ({ fence, ...draft }, options) =>
      inMemory(options, () => {
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        if (queue.has(draft.message)) {
          return err("exists");
        }
        queue.set(draft.message, structuredClone(draft));
        return ok(structuredClone(draft));
      }),
    waiting: async ({ sessionId, limit }, options) =>
      inMemory(options, () =>
        [...queue.values()]
          .filter((message) => message.sessionId === sessionId && isWaiting(message))
          .toSorted(byArrival)
          .slice(0, limit)
          .map((message) => structuredClone(message)),
      ),
  };
}

/** The {@link ChatQueueStore} of an in-memory agent database. */
export function createMemoryChatQueueStore(database: MemoryAgentDatabase): ChatQueueStore {
  const { queue } = database;
  return {
    ...arrivals(database),
    take: async ({ fence, messages, turn }, options) =>
      inMemory(options, () => {
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        const waiting = messages.map((id) => queue.get(id));
        if (!waiting.every(isWaiting) || new Set(messages).size !== messages.length) {
          return err("not_waiting");
        }
        const taken = waiting.map((message) => takenBy(message, turn));
        taken.forEach((message) => queue.set(message.message, message));
        return ok(structuredClone(taken));
      }),
    drop: async ({ fence, message, atMs, reason }, options) =>
      inMemory(options, () => {
        const stored = queue.get(message);
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        if (stored === undefined) {
          return err("not_found");
        }
        if (!isWaiting(stored)) {
          return err("not_waiting");
        }
        const dropped = { ...stored, droppedAtMs: atMs, dropReason: reason };
        queue.set(message, dropped);
        return ok(structuredClone(dropped));
      }),
  };
}
