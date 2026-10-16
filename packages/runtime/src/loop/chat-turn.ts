import { err } from "@binference/core";
import type { TurnOutcome } from "@binference/store";
import { createTurnHistory, type TurnCompaction } from "../compaction/turn-history.js";
import { takeImages } from "../images/take-images.js";
import type { StoredHistory } from "../sessions/conversation.js";
import { answerOpenCalls, endTurn, portFailure } from "./end-turn.js";
import { createLoopGuard } from "./loop-guard.js";
import type { ModelMessage, OwnerMessage } from "./model-message.js";
import { trackOpenCalls } from "./open-calls.js";
import { type TurnHalt, type TurnStop } from "./turn-halt.js";
import type { TurnRefusal } from "./turn-records.js";
import {
  createModelRoute,
  type TurnLimits,
  turnLimits,
  type TurnParts,
  type TurnRun,
} from "./turn-run.js";
import { type LoopEnd, takeStep } from "./turn-step.js";
import { createTurnTail } from "./turn-tail.js";
import { createTurnTally, type TurnState } from "./turn-tally.js";

/** What a turn starts from. */
export interface ChatTurnOptions {
  /** The turn id the engine reserved (`trn_…`). */
  readonly turnId: string;
  readonly parts: TurnParts;
  /** The stable prefix of the turn's model calls, read as the turn starts (runtime spec, 7.1). */
  readonly prefix: string;
  /** The session's conversation before this turn, as the context builder kept it. */
  readonly history: readonly ModelMessage[];
  /**
   * The same history as stored, and what compacts it (runtime spec, section 7.3); without them the
   * turn never compacts.
   */
  readonly compaction?: {
    readonly setup: TurnCompaction;
    readonly stored: StoredHistory;
  };
  /** The messages this turn takes from the chat queue, oldest first. */
  readonly taken: readonly OwnerMessage[];
  /** The history already holds outside content: an event or a summary marked so. */
  readonly outsideContent: boolean;
  /**
   * The runtime's lifetime: the turn's writes to the journal and the engine use it, so a stopped
   * turn still writes the results of the calls it did not run.
   */
  readonly lifetime: AbortSignal;
  readonly limits?: TurnLimits;
}

/** A turn that ran its loop, and what it did. */
interface EndedTurn {
  readonly state: "ended";
  readonly outcome: TurnOutcome;
  readonly committed: boolean;
  readonly heldBack: number;
  readonly toolCalls: number;
  readonly modelCalls: number;
}

/** A turn the engine refused to start. */
interface RefusedTurn {
  readonly state: "refused";
  readonly refusal: TurnRefusal;
}

/** How a turn ended. */
export type TurnReport = EndedTurn | RefusedTurn;

/** One turn of an agent's chat. */
export interface ChatTurn {
  readonly state: TurnState;
  /** Runs the turn to its end, once. */
  run(): Promise<TurnReport>;
  /** Halts the turn: calls not started get their "not run" result, and the turn ends `stopped`. */
  stop(reason: TurnStop): void;
}

// The turn's 10 minutes from `turn/start`: at the end it halts as a stop does, `failed`.
function startTimeLimit(run: TurnRun): () => void {
  const finished = new AbortController();
  run.parts.clock.sleep(run.limits.turnTimeMs, finished.signal).then(
    () => run.halt("time_limit"),
    () => undefined,
  );
  return () => finished.abort();
}

async function loopSteps(run: TurnRun): Promise<LoopEnd> {
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each model call follows the batch before it
    const step = await takeStep(run);
    if (step !== "next") {
      return step;
    }
  }
}

async function startTurn(run: TurnRun, taken: readonly OwnerMessage[]) {
  const request = {
    messages: taken.map((message) => message.id),
    outsideContent: run.tally.now().outside,
  };
  try {
    return await run.parts.engine.start(request, run.writes);
  } catch {
    return err("unavailable" as const);
  }
}

// The images of the taken messages, read before the first model call; a port that throws ends
// the turn failed, as it does in the loop.
async function imagesOrFail(run: TurnRun, taken: readonly OwnerMessage[], firstTaken: number) {
  try {
    return await takeImages(run, taken, firstTaken);
  } catch {
    run.halt("engine");
    return portFailure;
  }
}

// A port that throws in the loop ends the turn failed: the calls it wrote keep a result each.
async function loopOrFail(run: TurnRun): Promise<LoopEnd> {
  try {
    return await loopSteps(run);
  } catch {
    run.halt("engine");
    await answerOpenCalls(run);
    return portFailure;
  }
}

async function runTurn(
  run: TurnRun,
  taken: readonly OwnerMessage[],
  firstTaken: number,
): Promise<TurnReport> {
  const started = await startTurn(run, taken);
  if (!started.ok) {
    run.tally.enter("refused");
    return { state: "refused", refusal: started.error };
  }
  run.tail.budget(started.value.budgetLeftMicros);
  const clearTimeLimit = startTimeLimit(run);
  try {
    const unread = await imagesOrFail(run, taken, firstTaken);
    return await endTurn(run, unread ?? (await loopOrFail(run)));
  } finally {
    clearTimeLimit();
  }
}

/**
 * Creates one turn of an agent's chat (runtime spec, section 4): the engine starts it, then it
 * calls the model and runs each response's tool batch until the model answers with no call, a
 * proposal commits it, a limit or a halt ends it, and it writes its final text and its end.
 */
export function createChatTurn(options: ChatTurnOptions): ChatTurn {
  const halt = new AbortController();
  const outside = options.outsideContent || options.taken.some((message) => message.outside);
  const tally = createTurnTally({ outside });
  const journal = trackOpenCalls(options.parts.journal);
  const limits = options.limits ?? turnLimits;
  const run: TurnRun = {
    turnId: options.turnId,
    parts: { ...options.parts, journal },
    limits,
    prefix: options.prefix,
    tail: createTurnTail(options.parts.facts),
    messages: [
      ...options.history,
      ...options.taken.map((message) => ({ role: "owner" as const, text: message.text })),
    ],
    // A turn starts at its role's first model.
    route: createModelRoute(),
    ...(options.compaction === undefined
      ? {}
      : {
          history: createTurnHistory(options.compaction.setup, {
            stored: options.compaction.stored,
            size: options.history.length,
          }),
        }),
    tally,
    loopGuard: createLoopGuard({ enabled: limits.loopGuard }),
    halted: halt.signal,
    halt: (reason: TurnHalt) => halt.abort(reason),
    writes: options.lifetime,
    open: () => journal.open(),
  };
  let running: Promise<TurnReport> | undefined;
  return {
    get state() {
      return tally.now().state;
    },
    run: async () => {
      running ??= runTurn(run, options.taken, options.history.length);
      return running;
    },
    stop: (reason) => halt.abort(reason),
  };
}
