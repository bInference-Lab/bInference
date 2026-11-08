import {
  goalPauseReasonSchema,
  type GoalView,
  type ProgressNoteView,
  protocolIdSchema,
} from "@binference/protocol";
import type { GoalRecord, ProgressNoteRecord } from "@binference/store";

/** A chat's goal as the protocol shows it. */
export function goalViewOf(goal: GoalRecord): GoalView {
  const { pauseReason, note, budgetMicros } = goal;
  return {
    agent: protocolIdSchema("agent").parse(goal.agentId),
    session: protocolIdSchema("chatSession").parse(goal.sessionId),
    objective: goal.objective,
    status: goal.status,
    ...(pauseReason === undefined ? {} : { pauseReason: goalPauseReasonSchema.parse(pauseReason) }),
    ...(note === undefined ? {} : { note }),
    ...(budgetMicros === undefined ? {} : { budgetUsdMicros: budgetMicros }),
    spentUsdMicros: goal.spentMicros,
    goalTurns: goal.goalTurns,
    startedAt: goal.startedAtMs,
    updatedAt: goal.updatedAtMs,
  };
}

/** A chat's progress note as the protocol shows it. */
export function noteViewOf(note: ProgressNoteRecord): ProgressNoteView {
  return {
    agent: protocolIdSchema("agent").parse(note.agentId),
    session: protocolIdSchema("chatSession").parse(note.sessionId),
    markdown: note.markdown,
    plan: note.plan.map(({ text, state }) => ({ text, state })),
    updatedAt: note.updatedAtMs,
  };
}
