import { goalChangeLine, goalLines, progressNoteLines } from "@binference/i18n";
import { goalCommandOf, type GoalPush } from "@binference/protocol";
import { callOptions, type ChatContext } from "./chat-context.js";
import { failureText } from "./chat-lines.js";
import type { ScreenLine } from "./chat-screen.js";

// `/goal`, alone or with the words after it, as the owner types it.
const goalCommand = /^\/goal(?:\s+(.*))?$/is;

function dim(text: string): ScreenLine {
  return { text, tone: "dim" };
}

/** The words after `/goal` when the line is a `/goal` command, else `undefined`. */
export function goalWordsOf(line: string): string | undefined {
  const match = goalCommand.exec(line.trim());
  return match === null ? undefined : (match[1] ?? "");
}

// The chat's goal and progress note, as `/goal` alone prints them.
async function printGoal(context: ChatContext): Promise<void> {
  const read = await context.client.call(
    "goal/get",
    { agent: context.agent },
    callOptions(context),
  );
  const note = read.note === undefined ? [] : progressNoteLines(read.note, context.formatter);
  context.print([...goalLines(read.goal, context.formatter), ...note].map(dim));
}

/**
 * Runs the owner's `/goal` in terminal chat (decision 0407): alone it prints the chat's goal and
 * progress note; with an objective it sets the goal; `pause`, `resume` and `clear` change it. A
 * change prints as the status line its `chat/goal` push brings; a refusal prints why.
 */
export async function runGoalCommand(context: ChatContext, words: string): Promise<void> {
  const asked = goalCommandOf(words);
  const { agent } = context;
  try {
    if (asked.ask === "status") {
      await printGoal(context);
    } else if (asked.ask === "set") {
      await context.client.call(
        "goal/set",
        { agent, objective: asked.objective },
        callOptions(context),
      );
    } else {
      await context.client.call("goal/change", { agent, action: asked.ask }, callOptions(context));
    }
  } catch (error) {
    context.print([
      dim(context.words("tui.failed", { reason: failureText(context.words, error) })),
    ]);
  }
}

/**
 * What a `chat/goal` push prints (decision 0407): the status line of a change of the goal, and the
 * progress note whenever it changed.
 */
export function goalPushLines(context: ChatContext, push: GoalPush): readonly ScreenLine[] {
  const line = goalChangeLine(push.change, push.goal, context.formatter);
  const note =
    push.change === "note" && push.note !== undefined
      ? progressNoteLines(push.note, context.formatter)
      : [];
  return [...(line === undefined ? [] : [line]), ...note].map(dim);
}
