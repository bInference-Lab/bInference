import type { Clock, Id } from "@binference/core";
import type { ModelTransport, ToolBox } from "../loop/ports.js";
import type { TurnLimits } from "../loop/turn-run.js";
import type { EngineChat } from "../relay/ports.js";
import type { AgentStores } from "../sessions/agent-stores.js";
import type { AgentChats } from "./agent-chats.js";
import type { NewMessageMode } from "./queue-merge.js";

/** What an agent's next turn runs with: its model, its tools, its instructions and its limits. */
export interface TurnSetup {
  readonly transport: ModelTransport;
  readonly tools: ToolBox;
  readonly instructions: string;
  readonly limits?: TurnLimits;
}

/** What the chat runner works with. */
export interface ChatRunnerOptions {
  readonly stores: AgentStores;
  readonly engine: EngineChat;
  /** The setup of an agent's next turn, read as the turn starts. */
  readonly setup: (agent: Id<"agt">) => TurnSetup;
  /** `chats.newMessageMode` now. */
  readonly mode: () => NewMessageMode;
  readonly clock: Clock;
  /** The runtime's lifetime: the turns' writes, and the waits before a retry, end with it. */
  readonly lifetime: AbortSignal;
  /** Runs when the chat queue has room again for messages it left in the engine's inbox. */
  readonly onRoom?: () => void;
  /** Turns that run at once in the install; 4. */
  readonly maxRunning?: number;
  /** The wait before a turn the engine could not start is tried again; 30 seconds. */
  readonly retryMs?: number;
}

/** Runs work one piece at a time, in the order it was given, whatever the piece before did. */
export type Serial = <T>(work: () => Promise<T>) => Promise<T>;

/** The runner's shared state: its options, its agents' chats, its one line of work and its open work. */
export interface ChatContext extends ChatRunnerOptions {
  readonly chats: AgentChats;
  readonly serial: Serial;
  /** Keeps a piece of work open until it settles, so a test can wait for the runner to rest. */
  readonly track: (work: Promise<void>) => void;
  /** Holds `stopped` once the runtime's stop began: no turn starts after it. */
  readonly state: Set<"stopped">;
}

/** Creates a {@link Serial}. */
export function createSerial(): Serial {
  let tail: Promise<void> = Promise.resolve();
  return async (work) => {
    const run = tail.then(work, work);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** Open work, and a wait for all of it, including work that starts while it waits. */
export function createTracker(): {
  readonly track: (work: Promise<void>) => void;
  readonly settled: () => Promise<void>;
} {
  const open = new Set<Promise<void>>();
  return {
    track(work) {
      const kept = work.catch(() => undefined);
      open.add(kept);
      void kept.then(() => open.delete(kept));
    },
    async settled() {
      while (open.size > 0) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- work may start more work
        await Promise.allSettled(open);
      }
    },
  };
}
