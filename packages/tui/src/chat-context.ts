import type { ProtocolClient } from "@binference/client";
import type { Clock } from "@binference/core";
import type { Formatter } from "@binference/i18n";
import type { ProtocolId } from "@binference/protocol";
import type { Words } from "./chat-lines.js";
import type { ScreenLine } from "./chat-screen.js";
import type { ChatStore } from "./chat-state.js";

/** What terminal chat needs of the engine's client: its calls, its pushes and where it stands. */
export type ChatClient = Pick<ProtocolClient, "call" | "subscribe" | "status">;

/** What every part of the chat works with. */
export interface ChatContext {
  readonly client: ChatClient;
  readonly agent: ProtocolId<"agent">;
  /** The agent's name, made safe to show. */
  readonly agentName: string;
  /** Formats amounts and times, and draws cards and notices, in the owner's language. */
  readonly formatter: Formatter;
  /** The owner's words. */
  readonly words: Words;
  readonly clock: Clock;
  readonly store: ChatStore;
  /** Prints lines above the live area, for good. */
  readonly print: (lines: readonly ScreenLine[]) => void;
  /** Aborts when the chat closes: every call still running stops. */
  readonly signal: AbortSignal;
}

// A call waits at most this long for the engine.
const callTimeoutMs = 60_000;

/** The options of one call: it ends when the chat closes, or after 60 seconds. */
export function callOptions(context: Pick<ChatContext, "signal">): {
  readonly signal: AbortSignal;
} {
  return { signal: AbortSignal.any([context.signal, AbortSignal.timeout(callTimeoutMs)]) };
}

/**
 * Runs each job after the one before has ended, so what a job prints keeps the order the jobs
 * came in. A failed job never stops the next one; `failed` hears why it failed.
 */
export function createJobQueue(
  failed: (error: ErrorOptions["cause"]) => void,
): (job: () => Promise<void>) => void {
  let last: Promise<void> = Promise.resolve();
  return (job) => {
    last = last.then(job).catch(failed);
  };
}
