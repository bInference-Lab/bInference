import type { Locale } from "@binference/protocol";
import type { ModelUsage } from "../loop/model-event.js";
import type { ModelChain } from "../loop/ports.js";
import type { ModelRequest } from "../loop/turn-records.js";
import type { StoredHistory } from "../sessions/conversation.js";
import { estimateMessagesTokens, estimateRequestTokens } from "./token-estimate.js";

/**
 * The context window every model is taken to have, in tokens (decision 0202): a cautious size
 * that current models meet or pass. A context failure shows a smaller one.
 */
export const defaultContextTokens = 128_000;

/** The output every call reserves (runtime spec, section 8.1), which the input must leave room for. */
const outputReserveTokens = 4_096;

/** What a turn compacts its history with (runtime spec, section 7.3; decision 0202). */
export interface TurnCompaction {
  /** The model that writes summaries: `models.fast`, or `main` when no fast model is set. */
  readonly summarizer: ModelChain;
  /** The context window of the turn's model, in tokens. */
  readonly contextTokens: number;
  /** The session's language, which a summary is written in. */
  readonly locale: Locale;
}

/** A provider's count of a call's input, and how many messages of the conversation it held. */
interface Measured {
  readonly messages: number;
  readonly inputTokens: number;
}

/** A turn's history as compaction sees it, which changes when a summary is written. */
export interface TurnHistory {
  readonly compaction: TurnCompaction;
  /** The history as stored: the latest summary and the events after it. */
  stored(): StoredHistory;
  /** How many messages at the start of the turn's conversation are the history. */
  size(): number;
  /** The history is now `stored`, `size` messages long; earlier counts no longer hold. */
  replace(stored: StoredHistory, size: number): void;
  /** A call answered with its provider's count of what it sent. */
  measure(request: ModelRequest, usage: ModelUsage | undefined): void;
  /**
   * The estimated input of a call (runtime spec, section 7.3): the provider's count of the last
   * call that answered, plus the estimate of each message since, or the estimate of the whole
   * call when none answered since the history last changed.
   */
  estimate(request: ModelRequest): number;
  /** The call, with the output it reserves, passes 80% of the context window. */
  overThreshold(request: ModelRequest): boolean;
}

/** Creates a turn's history from what the turn loaded. */
export function createTurnHistory(
  compaction: TurnCompaction,
  loaded: { readonly stored: StoredHistory; readonly size: number },
): TurnHistory {
  let stored = loaded.stored;
  let size = loaded.size;
  let measured: Measured | undefined;
  const estimate = (request: ModelRequest): number =>
    measured === undefined || measured.messages > request.messages.length
      ? estimateRequestTokens(request)
      : measured.inputTokens + estimateMessagesTokens(request.messages.slice(measured.messages));
  return {
    compaction,
    stored: () => stored,
    size: () => size,
    replace(next, nextSize) {
      stored = next;
      size = nextSize;
      measured = undefined;
    },
    measure(request, usage) {
      if (usage !== undefined && usage.inputTokens > 0) {
        measured = { messages: request.messages.length, inputTokens: usage.inputTokens };
      }
    },
    estimate,
    overThreshold: (request) =>
      (estimate(request) + outputReserveTokens) * 5 > compaction.contextTokens * 4,
  };
}
