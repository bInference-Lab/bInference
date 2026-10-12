import { err, ok } from "@binference/core";
import type { TurnOutcome } from "@binference/store";
import type { OwnerMessage } from "../loop/model-message.js";
import type { MergeSource, TurnEngine, TurnJournal } from "../loop/ports.js";
import type { SummaryRecord, TurnRefusal, TurnStatusLine } from "../loop/turn-records.js";

/** One thing a turn wrote to its journal or told the engine, in the order it happened. */
export type RecordedStep =
  | { readonly kind: "start"; readonly messages: readonly string[]; readonly outside: boolean }
  | { readonly kind: "response"; readonly text: string }
  | { readonly kind: "call"; readonly id: string; readonly name: string }
  | { readonly kind: "proposal"; readonly id: string; readonly key: string }
  | {
      readonly kind: "result";
      readonly id: string;
      readonly text: string;
      readonly ran: boolean;
      readonly outside: boolean;
    }
  | { readonly kind: "joined"; readonly ids: readonly string[] }
  | ({ readonly kind: "summary" } & SummaryRecord)
  | { readonly kind: "journalMark" }
  | { readonly kind: "engineMark" }
  | { readonly kind: "say"; readonly text: string }
  | { readonly kind: "status"; readonly line: TurnStatusLine }
  | {
      readonly kind: "usage";
      readonly model: string;
      readonly usdMicros: bigint;
      readonly key: string;
    }
  | { readonly kind: "journalEnd"; readonly outcome: TurnOutcome; readonly heldBack: number }
  | { readonly kind: "end"; readonly outcome: TurnOutcome }
  | { readonly kind: "tool"; readonly name: string; readonly key: string };

/** How the recorder's engine answers. */
export interface TurnRecorderOptions {
  /** `turn/start` fails with this refusal. */
  readonly refuse?: TurnRefusal;
  /** `turn/mark` fails. */
  readonly failMark?: boolean;
  /** The merge source fails. */
  readonly failTake?: boolean;
  /** `turn/start` throws, as when the engine cannot be reached. */
  readonly failStart?: boolean;
  /** The agent's budget `usage/record` counts down from; $1 when absent. */
  readonly budgetMicros?: bigint;
  /** When a spent budget resumes, as the engine answers it once nothing is left; none when absent. */
  readonly resumesAt?: number;
  /** `usage/record` fails. */
  readonly failUsage?: boolean;
  /** Runs before each step is recorded, and the write waits for it: a test stops a turn here. */
  readonly beforeStep?: (step: RecordedStep) => void | Promise<void>;
}

/** A journal, an engine and a merge source for one turn, recording every step in one list. */
export interface TurnRecorder {
  readonly journal: TurnJournal;
  readonly engine: TurnEngine;
  readonly merge: MergeSource;
  readonly steps: readonly RecordedStep[];
  /** Adds messages that join the turn at its next merge point. */
  queue(...messages: readonly OwnerMessage[]): void;
  /** Records a step of the test's own, such as a tool's run. */
  note(step: RecordedStep): void;
}

type Write = (step: RecordedStep, signal: AbortSignal) => Promise<void>;

function createJournal(note: Write): TurnJournal {
  return {
    response: async ({ text }, signal) => note({ kind: "response", text }, signal),
    toolCall: async ({ id, name }, signal) => note({ kind: "call", id, name }, signal),
    proposal: async ({ call, idempotencyKey }, signal) =>
      note({ kind: "proposal", id: call.id, key: idempotencyKey }, signal),
    toolResult: async ({ callId, text, ran, outside }, signal) =>
      note({ kind: "result", id: callId, text, ran, outside }, signal),
    joined: async (messages, signal) =>
      note({ kind: "joined", ids: messages.map((message) => message.id) }, signal),
    summary: async ({ text, fromSeq, throughSeq, outside }, signal) =>
      note({ kind: "summary", text, fromSeq, throughSeq, outside }, signal),
    markOutside: async (signal) => note({ kind: "journalMark" }, signal),
    end: async ({ outcome, heldBack }, signal) =>
      note({ kind: "journalEnd", outcome, heldBack }, signal),
  };
}

function createEngine(note: Write, options: TurnRecorderOptions): TurnEngine {
  const budget = { leftMicros: options.budgetMicros ?? 1_000_000n };
  return {
    start: async ({ messages, outsideContent }, signal) => {
      if (options.failStart === true) {
        throw new Error("The engine cannot be reached.");
      }
      await note({ kind: "start", messages, outside: outsideContent }, signal);
      return options.refuse === undefined
        ? ok({ budgetLeftMicros: 1_000_000n })
        : err(options.refuse);
    },
    mark: async (signal) => {
      if (options.failMark === true) {
        throw new Error("The engine did not take the mark.");
      }
      await note({ kind: "engineMark" }, signal);
    },
    say: async (text, signal) => note({ kind: "say", text }, signal),
    status: async (line, signal) => note({ kind: "status", line }, signal),
    recordUsage: async ({ model, usdMicros, key }, signal) => {
      if (options.failUsage === true) {
        throw new Error("The engine did not take the record.");
      }
      await note({ kind: "usage", model, usdMicros, key }, signal);
      budget.leftMicros -= usdMicros;
      const { resumesAt } = options;
      const resumes = budget.leftMicros > 0n || resumesAt === undefined ? {} : { resumesAt };
      return { budgetLeftMicros: budget.leftMicros, ...resumes };
    },
    end: async (outcome, signal) => note({ kind: "end", outcome }, signal),
  };
}

/** Creates a recorder whose engine starts every turn and takes every mark, unless told not to. */
export function createTurnRecorder(options: TurnRecorderOptions = {}): TurnRecorder {
  const steps: RecordedStep[] = [];
  const waiting: OwnerMessage[] = [];
  const note = (step: RecordedStep): void => {
    steps.push(step);
  };
  // A write on an aborted signal rejects and records nothing, as a store's write does.
  const write = async (step: RecordedStep, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    await options.beforeStep?.(step);
    note(step);
  };
  return {
    journal: createJournal(write),
    engine: createEngine(write, options),
    merge: {
      take: async () => {
        if (options.failTake === true) {
          throw new Error("The chat queue cannot be read.");
        }
        return waiting.splice(0);
      },
    },
    steps,
    queue: (...messages) => {
      waiting.push(...messages);
    },
    note,
  };
}
