/** Where a turn is (runtime spec, section 4.1). */
export type TurnState =
  | "starting"
  | "streaming"
  | "tools"
  | "committed"
  | "ending"
  | "ended"
  | "refused";

/** What a turn has done so far. */
interface TurnMarks {
  readonly state: TurnState;
  /** The turn's context holds outside content. */
  readonly outside: boolean;
  /** A propose call's body started. */
  readonly committed: boolean;
  /** Propose calls held back by the one-proposal rule. */
  readonly heldBack: number;
  /** Tool calls the model made in this turn, run or not. */
  readonly toolCalls: number;
  readonly modelCalls: number;
  /** Attempts of the turn's model calls, retries and fallbacks included, each one recorded. */
  readonly attempts: number;
  /** The engine answered a usage record with nothing left of the budget: no model call follows. */
  readonly budgetSpent: boolean;
  /** When the spent budget resumes, when the engine said. */
  readonly resumesAt?: number;
  /** The loop guard found the same call with the same result three times. */
  readonly looped: boolean;
  /** The text of the last model response: the turn's final text. */
  readonly lastText: string;
  /** How the engine answered the turn's proposal: it waits for the owner, or was refused. */
  readonly proposal?: ProposalAnswer;
}

/** How the engine answered a proposal it heard: a card waits for the owner, or it was refused. */
type ProposalAnswer = "waits" | "refused";

/** A turn's marks as they change. Its marks only go from unset to set, and its counts only grow. */
export interface TurnTally {
  now(): TurnMarks;
  /** Moves to a state; `streaming` counts a model call, and a committed turn stays committed. */
  enter(state: TurnState): void;
  markOutside(): void;
  commit(): void;
  holdBack(): void;
  countToolCalls(count: number): void;
  /** Counts one attempt of a model call and answers its number in the turn, from 1. */
  countAttempt(): number;
  /** Marks the budget spent, with when it resumes when the engine said. */
  spendBudget(resumesAt?: number): void;
  markLooped(): void;
  keepText(text: string): void;
  answerProposal(answer: ProposalAnswer): void;
}

function entered(marks: TurnMarks, state: TurnState): TurnMarks {
  const modelCalls = marks.modelCalls + (state === "streaming" ? 1 : 0);
  return {
    ...marks,
    modelCalls,
    state: marks.committed && state === "tools" ? marks.state : state,
  };
}

/** A new turn's tally: `starting`, marked when its context already holds outside content. */
export function createTurnTally(options: { readonly outside: boolean }): TurnTally {
  let marks: TurnMarks = {
    state: "starting",
    outside: options.outside,
    committed: false,
    heldBack: 0,
    toolCalls: 0,
    modelCalls: 0,
    attempts: 0,
    budgetSpent: false,
    looped: false,
    lastText: "",
  };
  return {
    now: () => marks,
    enter(state) {
      marks = entered(marks, state);
    },
    markOutside() {
      marks = { ...marks, outside: true };
    },
    commit() {
      marks = { ...marks, committed: true, state: "committed" };
    },
    holdBack() {
      marks = { ...marks, heldBack: marks.heldBack + 1 };
    },
    countToolCalls(count) {
      marks = { ...marks, toolCalls: marks.toolCalls + count };
    },
    countAttempt() {
      marks = { ...marks, attempts: marks.attempts + 1 };
      return marks.attempts;
    },
    spendBudget(resumesAt) {
      marks = { ...marks, budgetSpent: true, ...(resumesAt === undefined ? {} : { resumesAt }) };
    },
    markLooped() {
      marks = { ...marks, looped: true };
    },
    keepText(lastText) {
      marks = { ...marks, lastText };
    },
    answerProposal(proposal) {
      marks = { ...marks, proposal };
    },
  };
}
