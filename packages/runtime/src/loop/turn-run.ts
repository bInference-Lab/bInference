import type { Clock } from "@binference/core";
import type { LoopGuard } from "./loop-guard.js";
import type { ModelMessage } from "./model-message.js";
import type { OpenCall } from "./open-calls.js";
import type {
  LiveFactsReader,
  MergeSource,
  ModelChain,
  ToolBox,
  TurnEngine,
  TurnJournal,
} from "./ports.js";
import type { TurnHalt } from "./turn-halt.js";
import type { TurnTail } from "./turn-tail.js";
import type { TurnTally } from "./turn-tally.js";

/** What one turn works with, bound to that turn by the composition. */
export interface TurnParts {
  /** The models the turn may call, in order. */
  readonly models: ModelChain;
  readonly tools: ToolBox;
  readonly journal: TurnJournal;
  readonly engine: TurnEngine;
  readonly merge: MergeSource;
  /** The agent's live facts, which each model call sends after the history. */
  readonly facts: LiveFactsReader;
  readonly clock: Clock;
}

/** The limits of one turn (runtime spec, sections 4.4, 5.2 and 9). */
export interface TurnLimits {
  readonly maxToolCalls: number;
  readonly maxModelCalls: number;
  /** A read or control call's time. */
  readonly toolTimeoutMs: number;
  /** How long a propose call waits for the engine. */
  readonly proposeTimeoutMs: number;
  /** How long a propose call already sent may still finish after a stop. */
  readonly stopGraceMs: number;
  /** The turn's time from `turn/start`. */
  readonly turnTimeMs: number;
  /** How long a model call may go without an event before it is cut (`models.idleTimeoutMs`). */
  readonly modelIdleMs: number;
  /** How long each write of a turn's end may take before the turn ends without it. */
  readonly endWriteTimeoutMs: number;
  /** Whether the loop guard ends a turn that repeats itself (`models.loopDetection`). */
  readonly loopGuard: boolean;
}

/**
 * The runtime spec's limits: 25 tool calls and 40 model calls a turn, 10 minutes, 2 minutes
 * without a model's event, and the loop guard on.
 */
export const turnLimits: TurnLimits = {
  maxToolCalls: 25,
  maxModelCalls: 40,
  toolTimeoutMs: 60_000,
  proposeTimeoutMs: 30_000,
  stopGraceMs: 5_000,
  turnTimeMs: 600_000,
  modelIdleMs: 120_000,
  endWriteTimeoutMs: 10_000,
  loopGuard: true,
};

/** Where a turn stands in its chain of models. */
export interface ModelRoute {
  /** The chain's index of the model the turn calls now. */
  at(): number;
  /** The turn calls the model at `index` from now on. */
  moveTo(index: number): void;
}

/** One running turn, as each step of the loop sees it. */
export interface TurnRun {
  readonly turnId: string;
  readonly parts: TurnParts;
  readonly limits: TurnLimits;
  /** The stable prefix every model call of the turn sends, read as the turn started. */
  readonly prefix: string;
  /** The volatile tail each model call sends after the conversation. */
  readonly tail: TurnTail;
  /** The conversation each model call sends; the loop appends to it. */
  readonly messages: ModelMessage[];
  /** The chain's model the turn calls now: a fallback lasts for the turn. */
  readonly route: ModelRoute;
  readonly tally: TurnTally;
  /** Watches the turn's calls for the same call with the same result three times. */
  readonly loopGuard: LoopGuard;
  /** Aborts, with its {@link TurnHalt}, when the turn halts. */
  readonly halted: AbortSignal;
  readonly halt: (reason: TurnHalt) => void;
  /**
   * The signal of the turn's writes to the journal and the engine. It outlives a halt, so a
   * halted turn still writes the results of the calls it did not run, and its end.
   */
  readonly writes: AbortSignal;
  /** The calls the journal holds without a result. */
  readonly open: () => readonly OpenCall[];
}
