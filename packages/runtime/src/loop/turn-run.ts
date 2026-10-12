import type { Clock } from "@binference/core";
import type { ModelMessage } from "./model-message.js";
import type { OpenCall } from "./open-calls.js";
import type { MergeSource, ModelTransport, ToolBox, TurnEngine, TurnJournal } from "./ports.js";
import type { TurnHalt } from "./turn-halt.js";
import type { TurnTally } from "./turn-tally.js";

/** What one turn works with, bound to that turn by the composition. */
export interface TurnParts {
  readonly transport: ModelTransport;
  readonly tools: ToolBox;
  readonly journal: TurnJournal;
  readonly engine: TurnEngine;
  readonly merge: MergeSource;
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
  /** How long each write of a turn's end may take before the turn ends without it. */
  readonly endWriteTimeoutMs: number;
}

/** The runtime spec's limits: 25 tool calls and 40 model calls a turn, 10 minutes. */
export const turnLimits: TurnLimits = {
  maxToolCalls: 25,
  maxModelCalls: 40,
  toolTimeoutMs: 60_000,
  proposeTimeoutMs: 30_000,
  stopGraceMs: 5_000,
  turnTimeMs: 600_000,
  endWriteTimeoutMs: 10_000,
};

/** One running turn, as each step of the loop sees it. */
export interface TurnRun {
  readonly turnId: string;
  readonly parts: TurnParts;
  readonly limits: TurnLimits;
  readonly instructions: string;
  /** The conversation each model call sends; the loop appends to it. */
  readonly messages: ModelMessage[];
  readonly tally: TurnTally;
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
