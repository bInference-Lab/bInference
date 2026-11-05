import type { Id } from "@binference/core";
import type { EngineChat } from "../engine-chat/ports.js";

/** One thing the fake engine pushed on an agent's chat topic, as the engine names its kind. */
export interface ChatPush {
  readonly kind: "chat/turnStarted" | "chat/message" | "chat/status" | "chat/turnEnded";
  readonly agent: Id<"agt">;
  readonly turn: Id<"trn">;
  /** The text of `chat/message`, the key of `chat/status`, the outcome of `chat/turnEnded`. */
  readonly detail?: string;
  /** The values of `chat/status`, when it has any. */
  readonly values?: Readonly<Record<string, number>>;
}

/**
 * A draft of the turn's text, a progress line or the model's reasoning the fake engine pushed:
 * `chat/message` with `final: false`, `chat/progress` or `chat/reasoning` (`reasoning` while it
 * grows, `reasoningEnd` once a call ended). They stay apart from {@link ChatPush}, as a surface
 * shows them only while the turn runs, or keeps them as it chooses.
 */
export interface FeedPush {
  readonly kind: "draft" | "progress" | "reasoning" | "reasoningEnd";
  readonly agent: Id<"agt">;
  readonly turn: Id<"trn">;
  /** The draft's text, the progress line's key, or the reasoning. */
  readonly detail: string;
  readonly values?: Readonly<Record<string, string>>;
}

/** What the fake engine pushed on the chat topics, and those that wait for the next push. */
export interface ChatTopicLog {
  readonly pushes: ChatPush[];
  readonly feed: FeedPush[];
  readonly waiters: Set<(push: ChatPush) => void>;
}

/** Adds a push to the log and hands it to each waiter. */
export function pushChat(log: ChatTopicLog, push: ChatPush): void {
  log.pushes.push(push);
  for (const waiter of log.waiters) {
    waiter(push);
  }
}

/**
 * The fake engine's `turn/say`, `turn/status`, `turn/progress` and `turn/reasoning`: a final text and a status line
 * go on the chat topic, a draft and a progress line on the feed. `reach` throws while the engine
 * cannot be reached.
 */
export function topicCalls(
  log: ChatTopicLog,
  reach: (signal: AbortSignal) => void,
): Pick<EngineChat, "sayTurn" | "turnStatus" | "turnProgress" | "turnReasoning"> {
  return {
    async sayTurn({ agent, turn, text, final }, signal) {
      reach(signal);
      if (final) {
        pushChat(log, { kind: "chat/message", agent, turn, detail: text });
      } else {
        log.feed.push({ kind: "draft", agent, turn, detail: text });
      }
      return Promise.resolve();
    },
    async turnStatus({ agent, turn, statusKey, values }, signal) {
      reach(signal);
      const shown = values === undefined ? {} : { values };
      pushChat(log, { kind: "chat/status", agent, turn, detail: statusKey, ...shown });
      return Promise.resolve();
    },
    async turnProgress({ agent, turn, progressKey, values }, signal) {
      reach(signal);
      const shown = values === undefined ? {} : { values };
      log.feed.push({ kind: "progress", agent, turn, detail: progressKey, ...shown });
      return Promise.resolve();
    },
    async turnReasoning({ agent, turn, text, final }, signal) {
      reach(signal);
      log.feed.push({ kind: final ? "reasoningEnd" : "reasoning", agent, turn, detail: text });
      return Promise.resolve();
    },
  };
}
