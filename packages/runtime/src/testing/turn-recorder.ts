import { err, ok } from "@binference/core";
import type { TurnOutcome } from "@binference/store";
import type { OwnerMessage } from "../loop/model-message.js";
import type {
  MergeSource,
  TurnEngine,
  TurnJournal,
  TurnRefusal,
  TurnStatusLine,
} from "../loop/turn-ports.js";

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
  | { readonly kind: "journalMark" }
  | { readonly kind: "engineMark" }
  | { readonly kind: "say"; readonly text: string }
  | { readonly kind: "status"; readonly line: TurnStatusLine }
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

type Write = (step: RecordedStep) => Promise<void>;

function createJournal(note: Write): TurnJournal {
  return {
    response: async ({ text }) => note({ kind: "response", text }),
    toolCall: async ({ id, name }) => note({ kind: "call", id, name }),
    proposal: async ({ call, idempotencyKey }) =>
      note({ kind: "proposal", id: call.id, key: idempotencyKey }),
    toolResult: async ({ callId, text, ran, outside }) =>
      note({ kind: "result", id: callId, text, ran, outside }),
    joined: async (messages) =>
      note({ kind: "joined", ids: messages.map((message) => message.id) }),
    markOutside: async () => note({ kind: "journalMark" }),
    end: async ({ outcome, heldBack }) => note({ kind: "journalEnd", outcome, heldBack }),
  };
}

function createEngine(note: Write, options: TurnRecorderOptions): TurnEngine {
  return {
    start: async ({ messages, outsideContent }) => {
      if (options.failStart === true) {
        throw new Error("The engine cannot be reached.");
      }
      await note({ kind: "start", messages, outside: outsideContent });
      return options.refuse === undefined
        ? ok({ budgetLeftMicros: 1_000_000n })
        : err(options.refuse);
    },
    mark: async () => {
      if (options.failMark === true) {
        throw new Error("The engine did not take the mark.");
      }
      await note({ kind: "engineMark" });
    },
    say: async (text) => note({ kind: "say", text }),
    status: async (line) => note({ kind: "status", line }),
    end: async (outcome) => note({ kind: "end", outcome }),
  };
}

/** Creates a recorder whose engine starts every turn and takes every mark, unless told not to. */
export function createTurnRecorder(options: TurnRecorderOptions = {}): TurnRecorder {
  const steps: RecordedStep[] = [];
  const waiting: OwnerMessage[] = [];
  const note = (step: RecordedStep): void => {
    steps.push(step);
  };
  const write = async (step: RecordedStep): Promise<void> => {
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
