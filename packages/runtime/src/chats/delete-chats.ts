import type { Id } from "@binference/core";
import type { ChatContext } from "./chat-context.js";
import { cancelWait } from "./goal-pace.js";

// Forgets what the chat holds in memory of each agent: its open session, so no turn of it starts
// until its next message names one, the session a clear closes, its waits and its goal's wait.
function forget(context: ChatContext, agents: readonly Id<"agt">[]): void {
  const { chats } = context;
  for (const agent of agents) {
    cancelWait(context, agent);
    chats.sessions.delete(agent);
    chats.closing.delete(agent);
    chats.resumesAt.delete(agent);
    chats.full.delete(agent);
  }
}

// Ends each agent's running turn as a clear ends it and stops its helpers; answers what to wait
// for. A turn hands its end to the chat's line, so its end is waited for outside the line.
function halt(context: ChatContext, agents: readonly Id<"agt">[]): readonly Promise<void>[] {
  forget(context, agents);
  return agents.flatMap((agent): Promise<void>[] => {
    const running = context.chats.running.get(agent);
    running?.turn.stop("clear");
    const helpers = context.onStop?.(agent) ?? Promise.resolve();
    return running === undefined ? [helpers] : [running.done, helpers];
  });
}

async function haltThenRemove<T>(
  context: ChatContext,
  agents: readonly Id<"agt">[],
  remove: () => Promise<T>,
): Promise<T> {
  const ends = await context.serial(async () => halt(context, agents));
  await Promise.allSettled(ends);
  return context.serial(async () => {
    forget(context, agents);
    return remove();
  });
}

/**
 * Deletes the agents' chats at the owner's word (decision 0415): in line with the messages the
 * chat took before, each agent's running turn ends and its helpers stop, and both are waited for,
 * so nothing they write can land after the deletion; then, in line again, `remove` runs. A message
 * of the agents that arrives meanwhile is taken once it ended, into the new session it names.
 */
export async function deleteChats<T>(
  context: ChatContext,
  agents: readonly Id<"agt">[],
  remove: () => Promise<T>,
): Promise<T> {
  const deleted = haltThenRemove(context, agents, remove);
  const ended = deleted.then(
    () => undefined,
    () => undefined,
  );
  const { deleting } = context.chats;
  agents.forEach((agent) => deleting.set(agent, ended));
  try {
    return await deleted;
  } finally {
    agents
      .filter((agent) => deleting.get(agent) === ended)
      .forEach((agent) => deleting.delete(agent));
  }
}
