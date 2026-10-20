import type { ChatPush } from "./memory-engine-chat.js";

/** The pushes a fake engine made, and those that wait for the next. */
interface PushLog {
  readonly pushes: readonly ChatPush[];
  readonly waiters: Set<(push: ChatPush) => void>;
}

/** The first push that matches, already made or the next to come. */
export async function waitForPush(
  log: PushLog,
  match: (push: ChatPush) => boolean,
): Promise<ChatPush> {
  const made = log.pushes.find(match);
  if (made !== undefined) {
    return made;
  }
  return new Promise((resolve) => {
    const waiter = (push: ChatPush): void => {
      if (match(push)) {
        log.waiters.delete(waiter);
        resolve(push);
      }
    };
    log.waiters.add(waiter);
  });
}
