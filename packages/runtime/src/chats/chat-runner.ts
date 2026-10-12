import type { InboxMessageView } from "@binference/protocol";
import { createAgentChats } from "./agent-chats.js";
import { type ChatRunnerOptions, createSerial, createTracker } from "./chat-context.js";
import { receiveMessage, resumeWaiting } from "./chat-intake.js";

/** What the runtime's health line counts. */
export interface ChatCounts {
  readonly runningTurns: number;
  readonly waitingMessages: number;
}

/** The runtime's chat: the chat queue of each agent's open session and the turns it starts. */
export interface ChatRunner {
  /** Takes a message of the engine's inbox, pushed or listed, after the ones before it. */
  receive(view: InboxMessageView): Promise<void>;
  /** Picks up the messages a start found waiting, and starts their turns. */
  resume(): Promise<void>;
  counts(signal: AbortSignal): Promise<ChatCounts>;
  /** Ends every running turn as the runtime's stop and waits for their ends; the waiting stay. */
  stop(): Promise<void>;
  /** Settles once the runner rests: no message being taken, no turn running or about to start. */
  rested(): Promise<void>;
}

/**
 * Creates the runtime's chat (runtime spec, section 3; decision 0174): one queue per agent's open
 * session, one turn at a time per agent and at most 4 in the install, waiting messages that join
 * a running turn at its merge points in `merge` mode, and the next turn after a committed one.
 */
export function createChatRunner(options: ChatRunnerOptions): ChatRunner {
  const tracker = createTracker();
  const context = {
    ...options,
    chats: createAgentChats(),
    serial: createSerial(),
    track: tracker.track,
    state: new Set<"stopped">(),
  };
  return {
    receive: async (view) => receiveMessage(context, view),
    resume: async () => resumeWaiting(context),
    async counts(signal) {
      const waiting = await options.stores.queue.waiting({ limit: 1_000 }, { signal });
      return { runningTurns: context.chats.running.size, waitingMessages: waiting.length };
    },
    async stop() {
      context.state.add("stopped");
      const running = [...context.chats.running.values()];
      running.forEach(({ turn }) => turn.stop("runtime"));
      await Promise.allSettled(running.map(async ({ done }) => done));
    },
    rested: async () => tracker.settled(),
  };
}
