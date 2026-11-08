import type { Id } from "@binference/core";
import { written } from "../sessions/agent-stores.js";
import type { ChatContext } from "./chat-context.js";

/** Drops waiting messages with a reason; one no longer waiting is left as it is. */
export async function dropMessages(
  context: Pick<ChatContext, "stores" | "clock" | "lifetime">,
  messages: readonly Id<"msg">[],
  reason: string,
): Promise<void> {
  const { queue, fence } = context.stores;
  const signal = context.lifetime;
  for (const message of messages) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    const dropped = await queue.drop(
      { message, atMs: context.clock.now(), reason, fence },
      { signal },
    );
    if (!dropped.ok && dropped.error === "fenced") {
      written(dropped, "drop");
    }
  }
}
