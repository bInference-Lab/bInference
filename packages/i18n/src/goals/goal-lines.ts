import type { GoalChange, GoalView, ProgressNoteView } from "@binference/protocol";
import type { Formatter } from "../format/create-formatter.js";
import { displayOutsideText } from "../format/outside-text.js";

// The most goal turns a goal gets (decision 0407), as the lines name it.
const mostGoalTurns = 50;

// The agent's words as the owner reads them: every character a reader cannot see written out.
const shown = (text: string): string => displayOutsideText(text, Number.POSITIVE_INFINITY);

function words(formatter: Formatter, key: string, values?: Readonly<Record<string, string>>) {
  return formatter.message(key, values);
}

function pausedLine(goal: GoalView, formatter: Formatter): string {
  const reason = goal.pauseReason ?? "owner";
  const budget = goal.budgetUsdMicros === undefined ? "" : formatter.usd(goal.budgetUsdMicros);
  return words(formatter, `turn.goal.paused.${reason}`, {
    budget,
    turns: String(mostGoalTurns),
  });
}

/**
 * The status line a change of a chat's goal shows on every surface (decision 0407): set, paused
 * with why, resumed, complete or blocked with the agent's note, or cleared. A change of the
 * progress note alone has none.
 */
export function goalChangeLine(
  change: GoalChange,
  goal: GoalView | undefined,
  formatter: Formatter,
): string | undefined {
  if (change === "note") {
    return undefined;
  }
  if (change === "cleared" || goal === undefined) {
    return words(formatter, "turn.goal.cleared");
  }
  if (change === "paused") {
    return pausedLine(goal, formatter);
  }
  const line = words(formatter, `turn.goal.${change}`, { objective: shown(goal.objective) });
  const note =
    goal.note === undefined ? [] : [words(formatter, "turn.goal.note", { note: shown(goal.note) })];
  return [line, ...note].join("\n");
}

/**
 * A chat's goal as the owner's `/goal` reads it (decision 0407): its status and objective, its goal
 * turns, its spend against its budget, why it paused or the agent's note, and what `/goal` does to
 * it; a chat with no goal says how to set one.
 */
export function goalLines(goal: GoalView | undefined, formatter: Formatter): readonly string[] {
  if (goal === undefined) {
    return [words(formatter, "turn.goal.none")];
  }
  const status = words(formatter, `turn.goal.status.${goal.status}`);
  const spent = formatter.usd(goal.spentUsdMicros);
  const budget = goal.budgetUsdMicros;
  return [
    words(formatter, "turn.goal.summary", { status, objective: shown(goal.objective) }),
    words(formatter, "turn.goal.turns", {
      turns: String(goal.goalTurns),
      most: String(mostGoalTurns),
    }),
    budget === undefined
      ? words(formatter, "turn.goal.spent", { spent })
      : words(formatter, "turn.goal.spentOf", { spent, budget: formatter.usd(budget) }),
    ...(goal.status === "paused" ? [pausedLine(goal, formatter)] : []),
    ...(goal.note === undefined
      ? []
      : [words(formatter, "turn.goal.note", { note: shown(goal.note) })]),
    words(formatter, "turn.goal.actions"),
  ];
}

/**
 * A chat's progress note as every surface shows it (decision 0407): its title, the agent's
 * markdown, then each step of the plan in order with where it stands.
 */
export function progressNoteLines(note: ProgressNoteView, formatter: Formatter): readonly string[] {
  const steps = note.plan.map((step, place) =>
    words(formatter, "turn.goal.step", {
      place: String(place + 1),
      text: shown(step.text),
      state: words(formatter, `turn.goal.stepState.${step.state}`),
    }),
  );
  const markdown = note.markdown.trim() === "" ? [] : [shown(note.markdown)];
  return [words(formatter, "turn.goal.noteTitle"), ...markdown, ...steps];
}
