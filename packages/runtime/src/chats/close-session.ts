import type { Id } from "@binference/core";
import { written } from "../sessions/agent-stores.js";
import type { ChatContext } from "./chat-context.js";

/** Closes a session a clear ended, at the version it holds now; one already closed stays so. */
export async function closeSession(context: ChatContext, session: Id<"ses">): Promise<void> {
  const { sessions, fence } = context.stores;
  const signal = context.lifetime;
  const stored = await sessions.get(session, { signal });
  if (stored !== undefined && stored.clearedAtMs === undefined) {
    const close = { session, atMs: context.clock.now(), version: stored.version, fence };
    written(await sessions.close(close, { signal }), "close a session");
  }
}
