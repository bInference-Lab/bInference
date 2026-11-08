import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyResultSchema } from "../values/empty.schema.js";
import {
  goalTextLimit,
  type GoalView,
  goalViewSchema,
  type ProgressNoteView,
  progressNoteViewSchema,
} from "../views/goal-view.schema.js";
import { type ChatSurface, chatSurfaceSchema } from "../views/inbox-message-view.schema.js";
import {
  readFlags,
  routedReadFlags,
  routedWriteFlags,
  type OperationTable,
} from "./operation.schema.js";

/** The args of a goal call: the agent, and its chat; the engine names the open chat when absent. */
interface GoalArgs {
  readonly agent: ProtocolId<"agent">;
  readonly session?: ProtocolId<"chatSession">;
}

/** The args of `goal/set`: the objective, and the most its turns may spend. */
interface GoalSetArgs extends GoalArgs {
  readonly objective: string;
  readonly budgetUsdMicros?: bigint;
}

/** What the owner does to a chat's goal: pause it, resume it, or clear it. */
export type GoalAction = "pause" | "resume" | "clear";

/** The args of `goal/change`. */
interface GoalChangeArgs extends GoalArgs {
  readonly action: GoalAction;
}

/** A chat's goal and progress note, either absent. */
export interface GoalRead {
  readonly goal?: GoalView;
  readonly note?: ProgressNoteView;
}

/**
 * The args of `goal/continue`: the agent runtime asks for the next goal turn of a chat, with the
 * words binference writes in the owner's place, marked when the turn before it was.
 */
interface GoalContinueArgs {
  readonly agent: ProtocolId<"agent">;
  readonly session: ProtocolId<"chatSession">;
  readonly surface: ChatSurface;
  readonly text: string;
  readonly outsideContent: boolean;
}

/**
 * What changed of a chat's goal or progress note, which a surface tells in a status line: the goal
 * was set, paused, resumed, completed, blocked or cleared, or only the note changed.
 */
export type GoalChange = "set" | "paused" | "resumed" | "complete" | "blocked" | "cleared" | "note";

/** The args of `goal/show`: a change of a chat's goal or note, pushed as `chat/goal`. */
interface GoalShowArgs extends GoalRead {
  readonly agent: ProtocolId<"agent">;
  readonly session: ProtocolId<"chatSession">;
  readonly change: GoalChange;
}

/** The goal operations, by name (decision 0407). */
export interface GoalOperationShapes {
  readonly "goal/get": { readonly args: GoalArgs; readonly result: GoalRead };
  readonly "goal/set": {
    readonly args: GoalSetArgs;
    readonly result: { readonly goal: GoalView };
  };
  readonly "goal/change": { readonly args: GoalChangeArgs; readonly result: GoalRead };
  readonly "goal/continue": { readonly args: GoalContinueArgs; readonly result: Empty };
  readonly "goal/show": { readonly args: GoalShowArgs; readonly result: Empty };
}

const agent = protocolIdSchema("agent");
const session = protocolIdSchema("chatSession");
const readSchema: z.ZodType<GoalRead> = z.object({
  goal: goalViewSchema.exactOptional(),
  note: progressNoteViewSchema.exactOptional(),
});

/** Parses a goal change. */
export const goalChangeSchema: z.ZodType<GoalChange, string> = z.enum([
  "set",
  "paused",
  "resumed",
  "complete",
  "blocked",
  "cleared",
  "note",
]);

/** The goal operations, by name. */
export const goalOperations: OperationTable<GoalOperationShapes> = {
  "goal/get": {
    ...routedReadFlags,
    name: "goal/get",
    scope: "read",
    args: z.strictObject({ agent, session: session.exactOptional() }),
    result: readSchema,
  },
  "goal/set": {
    ...routedWriteFlags,
    name: "goal/set",
    scope: "chat",
    args: z.strictObject({
      agent,
      session: session.exactOptional(),
      objective: z.string().trim().min(1).max(goalTextLimit),
      budgetUsdMicros: decimalStringSchema.exactOptional(),
    }),
    result: z.object({ goal: goalViewSchema }),
  },
  "goal/change": {
    ...routedWriteFlags,
    name: "goal/change",
    scope: "chat",
    args: z.strictObject({
      agent,
      session: session.exactOptional(),
      action: z.enum(["pause", "resume", "clear"]),
    }),
    result: readSchema,
  },
  "goal/continue": {
    ...readFlags,
    name: "goal/continue",
    scope: "agent",
    args: z.strictObject({
      agent,
      session,
      surface: chatSurfaceSchema,
      text: z
        .string()
        .trim()
        .min(1)
        .max(goalTextLimit + 500),
      outsideContent: z.boolean(),
    }),
    result: emptyResultSchema,
  },
  "goal/show": {
    ...readFlags,
    name: "goal/show",
    scope: "agent",
    args: z.strictObject({
      agent,
      session,
      change: goalChangeSchema,
      goal: goalViewSchema.exactOptional(),
      note: progressNoteViewSchema.exactOptional(),
    }),
    result: emptyResultSchema,
  },
};
