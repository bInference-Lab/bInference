import type { Id } from "@binference/core";
import type { OwnerMessage } from "../loop/model-message.js";
import type { MergeSource } from "../loop/ports.js";
import { type AgentStores, written } from "../sessions/agent-stores.js";
import { ownerMessageOf, turnMessageOf } from "./queued-view.js";

/** The chat mode that decides whether a waiting message joins a running turn. */
export type NewMessageMode = "merge" | "after";

/** What the chat queue's side of one running turn works with. */
export interface QueueMergeOptions {
  readonly stores: AgentStores;
  readonly session: Id<"ses">;
  readonly turn: Id<"trn">;
  /** The mode now: settings that change apply at the next merge point. */
  readonly mode: () => NewMessageMode;
  /** Runs a take after the chat queue's other changes, one at a time. */
  readonly serial: <T>(work: () => Promise<T>) => Promise<T>;
}

/** At most this many messages join a turn at one merge point, or start one. */
export const messagesPerTurn = 20;

async function takeWaiting(
  options: QueueMergeOptions,
  signal: AbortSignal,
): Promise<readonly OwnerMessage[]> {
  const { stores, session, turn } = options;
  const waiting = await stores.queue.waiting(
    { sessionId: session, limit: messagesPerTurn },
    { signal },
  );
  const joining = waiting.flatMap((message) => {
    const view = turnMessageOf(message);
    return view === undefined ? [] : [{ id: message.message, owner: ownerMessageOf(view) }];
  });
  if (joining.length === 0) {
    return [];
  }
  const take = { messages: joining.map(({ id }) => id), turn, fence: stores.fence };
  written(await stores.queue.take(take, { signal }), "take");
  return joining.map(({ owner }) => owner);
}

/**
 * The chat queue's side of one running turn (runtime spec, section 3.4): in `merge` mode, the
 * session's waiting messages, oldest first and at most 20, taken by the turn as they join it; in
 * `after` mode none, so they start the next turn.
 */
export function createQueueMerge(options: QueueMergeOptions): MergeSource {
  return {
    async take(signal) {
      signal.throwIfAborted();
      if (options.mode() === "after") {
        return [];
      }
      return options.serial(async () => takeWaiting(options, signal));
    },
  };
}
