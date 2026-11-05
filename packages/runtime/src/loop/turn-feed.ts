import { type Clock, createDeadline } from "@binference/core";
import type { TurnEngine } from "./ports.js";

/**
 * What a running turn shows while it works (decision 0371): the text its model call has written
 * so far, and each tool it runs. Nothing it hands on is kept, and a send that fails or runs past
 * its time is given up, so the feed never holds a turn back.
 */
export interface TurnFeed {
  /** The text the turn's current model call has written so far. */
  text(soFar: string): void;
  /** The turn runs the tool of this name now: a draft that waits goes first. */
  tool(name: string): void;
  /** The reasoning the turn's current model call has given so far. */
  reasoning(soFar: string): void;
  /** A model call ended with this reasoning: a reasoning draft that waits gives way to it. */
  reasoningEnd(whole: string): void;
  /**
   * Drops a draft that waits, takes nothing more, and resolves once the sends already handed on
   * are done, so the final text never reaches the engine before a draft.
   */
  settle(): Promise<void>;
}

/** What {@link createTurnFeed} sends through and paces by. */
export interface TurnFeedOptions {
  readonly engine: Pick<TurnEngine, "draft" | "progress" | "reasoning">;
  readonly clock: Clock;
  /** The signal of the turn's writes. */
  readonly signal: AbortSignal;
}

type Send = (signal: AbortSignal) => Promise<void>;

/** The feed's sends, one at a time, in the order they were handed on. */
interface SendLine {
  send(call: Send): void;
  /** Resolves once every send handed on is done. */
  done(): Promise<void>;
}

/** The draft that waits for its time. */
interface DraftPacer {
  take(text: string): void;
  /** The waiting text goes now. */
  flush(): void;
  /** The next text starts a draft of its own, after what was handed on since. */
  cut(): void;
  /** Drops the waiting text. */
  stop(): void;
}

// A draft at most four times a second: a surface paces its own view as it needs.
const draftEveryMs = 250;
// The longest one send may take before it is given up.
const sendTimeoutMs = 5_000;

async function sendOnce(options: TurnFeedOptions, call: Send): Promise<void> {
  const { clock, signal } = options;
  const deadline = createDeadline({ clock, signal, timeoutMs: sendTimeoutMs });
  await call(deadline.signal).catch(() => undefined);
  deadline.clear();
}

function createSendLine(options: TurnFeedOptions): SendLine {
  let tail = Promise.resolve();
  return {
    send(call) {
      tail = tail.then(async () => sendOnce(options, call));
    },
    done: async () => tail,
  };
}

/** What one pacer paces by, and how it sends a draft. */
interface PacerOptions extends TurnFeedOptions {
  readonly sendDraft: (text: string, signal: AbortSignal) => Promise<void>;
}

// A draft in line takes the newer text until it goes, so at most one draft waits in the line.
function createDraftPacer(options: PacerOptions, line: SendLine): DraftPacer {
  const { clock, sendDraft } = options;
  let pending: string | undefined;
  let slot: { text: string } | undefined;
  let timer: AbortController | undefined;
  let sentAtMs = Number.NEGATIVE_INFINITY;
  const flush = (): void => {
    timer?.abort();
    timer = undefined;
    if (pending === undefined) {
      return;
    }
    sentAtMs = clock.now();
    const inLine = slot;
    const draft = inLine ?? { text: pending };
    [draft.text, slot, pending] = [pending, draft, undefined];
    if (inLine !== undefined) {
      return;
    }
    line.send(async (signal) => {
      slot = slot === draft ? undefined : slot;
      await sendDraft(draft.text, signal);
    });
  };
  const arm = (): void => {
    const waitMs = sentAtMs + draftEveryMs - clock.now();
    if (waitMs <= 0) {
      flush();
      return;
    }
    timer = new AbortController();
    clock.sleep(waitMs, timer.signal).then(flush, () => undefined);
  };
  return {
    take(text) {
      pending = text;
      if (timer === undefined) {
        arm();
      }
    },
    flush,
    cut: () => {
      slot = undefined;
    },
    stop() {
      timer?.abort();
      [timer, pending] = [undefined, undefined];
    },
  };
}

/**
 * Creates a turn's feed: drafts go to the engine as `turn/say` with `final: false`, a quarter of a
 * second apart at most, the latest text replacing one that has not gone; tool lines go as
 * `turn/progress`, after the draft written before them. One send at a time, in order; each is
 * bounded by 5 seconds and its failure is dropped.
 */
export function createTurnFeed(options: TurnFeedOptions): TurnFeed {
  const { engine } = options;
  const line = createSendLine(options);
  const drafts = createDraftPacer(
    { ...options, sendDraft: async (text, signal) => engine.draft(text, signal) },
    line,
  );
  const thoughts = createDraftPacer(
    {
      ...options,
      sendDraft: async (text, signal) => engine.reasoning({ text, final: false }, signal),
    },
    line,
  );
  let isSettled = false;
  return {
    text(soFar) {
      if (!isSettled) {
        drafts.take(soFar);
      }
    },
    reasoning(soFar) {
      if (!isSettled && soFar !== "") {
        thoughts.take(soFar);
      }
    },
    reasoningEnd(whole) {
      thoughts.stop();
      thoughts.cut();
      if (!isSettled && whole !== "") {
        line.send(async (signal) => engine.reasoning({ text: whole, final: true }, signal));
      }
    },
    tool(name) {
      if (isSettled) {
        return;
      }
      drafts.flush();
      drafts.cut();
      line.send(async (signal) => options.engine.progress(name, signal));
    },
    async settle() {
      isSettled = true;
      drafts.stop();
      thoughts.stop();
      await line.done();
    },
  };
}
