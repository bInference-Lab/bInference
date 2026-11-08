import { z } from "zod";
import { type GoalChange, goalChangeSchema } from "../operations/goal-operations.schema.js";
import {
  type GoalView,
  goalViewSchema,
  type ProgressNoteView,
  progressNoteViewSchema,
} from "./goal-view.schema.js";

/**
 * A change of a chat's goal or progress note, pushed on the agent's chat topic as `chat/goal`
 * (decision 0407): the goal and the note as they stand after it, each absent when the chat has
 * none.
 */
export interface GoalPush {
  readonly kind: "chat/goal";
  readonly agent: string;
  readonly session: string;
  readonly change: GoalChange;
  readonly goal?: GoalView;
  readonly note?: ProgressNoteView;
}

const pushSchema = z.looseObject({
  kind: z.literal("chat/goal"),
  data: z.looseObject({
    agent: z.string().min(1),
    session: z.string().min(1),
    change: goalChangeSchema,
    goal: goalViewSchema.optional(),
    note: progressNoteViewSchema.optional(),
  }),
});

/**
 * Reads a push of an agent's chat topic as a {@link GoalPush}; `undefined` for any other push and
 * for one in a shape it cannot read.
 */
export function goalPushOf(push: {
  readonly kind: string;
  readonly data: unknown;
}): GoalPush | undefined {
  const parsed = pushSchema.safeParse(push);
  if (!parsed.success) {
    return undefined;
  }
  const { agent, session, change, goal, note } = parsed.data.data;
  return {
    kind: "chat/goal",
    agent,
    session,
    change,
    ...(goal === undefined ? {} : { goal }),
    ...(note === undefined ? {} : { note }),
  };
}

/** What the owner's `/goal` words ask: the goal's state, a new goal, or an action on it. */
export type GoalCommand =
  | { readonly ask: "status" }
  | { readonly ask: "set"; readonly objective: string }
  | { readonly ask: "pause" | "resume" | "clear" };

const actions: ReadonlySet<string> = new Set(["pause", "resume", "clear"]);

function isAction(word: string): word is "pause" | "resume" | "clear" {
  return actions.has(word);
}

/**
 * Reads the words after `/goal` as every surface does (decision 0407): none asks for the goal's
 * state, `pause`, `resume` or `clear` alone acts on it, and anything else is the objective of a new
 * goal.
 */
export function goalCommandOf(words: string): GoalCommand {
  const text = words.trim();
  if (text === "") {
    return { ask: "status" };
  }
  const lower = text.toLowerCase();
  return isAction(lower) ? { ask: lower } : { ask: "set", objective: text };
}
